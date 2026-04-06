import json
import logging
import os
import time
from typing import Any, Dict, List

import requests

logger = logging.getLogger(__name__)

KIE_CREATE_TASK_URL = "https://api.kie.ai/api/v1/jobs/createTask"
KIE_RECORD_INFO_URL = "https://api.kie.ai/api/v1/jobs/recordInfo"
KIE_VEO_GENERATE_URL = "https://api.kie.ai/api/v1/veo/generate"
DEFAULT_KIE_MODEL = "bytedance/v1-pro-text-to-video"
SEEDANCE_15_PRO_MODEL = "bytedance/seedance-1.5-pro"
GROK_IMAGINE_TEXT_TO_VIDEO_MODEL = "grok-imagine/text-to-video"
VEO3_QUALITY = "veo3"
VEO3_FAST = "veo3_fast"
VEO3_LITE = "veo3_lite"
SUPPORTED_KIE_MODELS = {
    DEFAULT_KIE_MODEL,
    SEEDANCE_15_PRO_MODEL,
    GROK_IMAGINE_TEXT_TO_VIDEO_MODEL,
    VEO3_QUALITY,
    VEO3_FAST,
    VEO3_LITE,
}


def _get_api_key() -> str | None:
    return os.getenv("KIE_API_KEY") or os.getenv("KIE_AI_API_KEY")


def normalize_kie_model(value: str | None) -> str:
    normalized = str(value or DEFAULT_KIE_MODEL).strip()
    return normalized if normalized in SUPPORTED_KIE_MODELS else DEFAULT_KIE_MODEL


def _extract_task_id(payload: Any) -> str | None:
    if not payload:
        return None
    if isinstance(payload, dict):
        data = payload.get("data") or {}
        for key in ("taskId", "task_id", "id"):
            if isinstance(data, dict) and data.get(key):
                return str(data.get(key))
        for key in ("taskId", "task_id", "id"):
            if payload.get(key):
                return str(payload.get(key))
    return None


def _extract_error_message(payload: Any) -> str | None:
    if not payload:
        return None
    if isinstance(payload, dict):
        for key in ("error", "message", "msg", "error_msg", "errorMessage", "status_msg"):
            value = payload.get(key)
            if value:
                return str(value)
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        for key in ("failMsg", "failCode", "status_msg"):
            value = data.get(key)
            if value:
                return str(value)
        code = payload.get("code")
        if code and str(code) not in {"0", "200", "success"}:
            return f"KIE returned code={code}"
    return None


def build_kie_request_payload(prompt_json: Dict[str, Any], model: str | None = None) -> Dict[str, Any]:
    resolved_model = normalize_kie_model(model)
    prompt_text = json.dumps(prompt_json, ensure_ascii=False)

    if resolved_model == SEEDANCE_15_PRO_MODEL:
        return {
            "model": resolved_model,
            "input": {
                "prompt": prompt_text,
                "aspect_ratio": "9:16",
                "resolution": "720p",
                "duration": "4",
                "fixed_lens": False,
                "generate_audio": False,
                "nsfw_checker": True,
            },
        }

    if resolved_model == GROK_IMAGINE_TEXT_TO_VIDEO_MODEL:
        return {
            "model": resolved_model,
            "input": {
                "prompt": prompt_text,
                "aspect_ratio": "9:16",
                "mode": "normal",
                "duration": "6",
                "resolution": "720p",
            },
        }

    return {
        "model": resolved_model,
        "input": {
            "prompt": prompt_text,
            "aspect_ratio": "9:16",
            "resolution": "720p",
            "duration": "5",
            "camera_fixed": False,
            "seed": -1,
            "enable_safety_checker": True,
            "nsfw_checker": True,
        },
    }


def submit_veo_video_task(prompt_json: Dict[str, Any], model: str | None = None) -> Dict[str, Any]:
    api_key = _get_api_key()
    resolved_model = normalize_kie_model(model)
    prompt_text = json.dumps(prompt_json, ensure_ascii=False) if isinstance(prompt_json, dict) else str(prompt_json)

    # Note: Using 9:16 aspect ratio as default for vertical content
    payload = {
        "prompt": prompt_text,
        "model": resolved_model,
        "aspect_ratio": "9:16",
        "generationType": "TEXT_2_VIDEO",
        "enableTranslation": True,
    }

    if not api_key:
        return {
            "provider": "kie.ai",
            "provider_model": resolved_model,
            "submission_status": "skipped",
            "task_id": None,
            "request_payload": payload,
            "response_payload": None,
            "error": "KIE_API_KEY is not configured",
        }

    response = requests.post(
        KIE_VEO_GENERATE_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=60,
    )
    response.raise_for_status()

    response_payload = None
    try:
        response_payload = response.json()
    except Exception:
        response_payload = {"raw": response.text}

    task_id = _extract_task_id(response_payload)
    error_message = None
    if not task_id:
        error_message = _extract_error_message(response_payload)

    return {
        "provider": "kie.ai",
        "provider_model": resolved_model,
        "submission_status": "submitted" if task_id else "unknown",
        "task_id": task_id,
        "task_state": "waiting" if task_id else None,
        "request_payload": payload,
        "response_payload": response_payload,
        "result_urls": [],
        "error": None if task_id else (error_message or "Task submitted but taskId missing in response"),
    }


def submit_kie_video_task(prompt_json: Dict[str, Any], model: str | None = None) -> Dict[str, Any]:
    resolved_model = normalize_kie_model(model)
    if resolved_model in {VEO3_QUALITY, VEO3_FAST, VEO3_LITE}:
        return submit_veo_video_task(prompt_json, resolved_model)

    api_key = _get_api_key()
    payload = build_kie_request_payload(prompt_json, resolved_model)

    if not api_key:
        return {
            "provider": "kie.ai",
            "provider_model": resolved_model,
            "submission_status": "skipped",
            "task_id": None,
            "request_payload": payload,
            "response_payload": None,
            "error": "KIE_API_KEY is not configured",
        }

    response = requests.post(
        KIE_CREATE_TASK_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=60,
    )
    response.raise_for_status()

    response_payload = None
    response_text = None
    try:
        response_payload = response.json()
    except Exception:
        response_text = response.text
        response_payload = {"raw": response_text}

    task_id = _extract_task_id(response_payload)
    error_message = None
    if not task_id:
        error_message = _extract_error_message(response_payload)
        if not error_message and response_text:
            error_message = "Task submitted but taskId missing in response"
        logger.warning(
            "KIE task submission missing taskId. status=%s payload=%s",
            response.status_code,
            response_payload,
        )

    return {
        "provider": "kie.ai",
        "provider_model": resolved_model,
        "submission_status": "submitted" if task_id else "unknown",
        "task_id": task_id,
        "task_state": "waiting" if task_id else None,
        "request_payload": payload,
        "response_payload": response_payload,
        "result_urls": [],
        "error": None if task_id else (error_message or "Task submitted but taskId missing in response"),
    }


def submit_kie_tasks_for_prompts(prompts: List[Dict[str, Any]], model: str | None = None) -> List[Dict[str, Any]]:
    enriched_prompts: List[Dict[str, Any]] = []

    for item in prompts or []:
        if item.get("use_ready_asset") or not item.get("prompt_json"):
            enriched_prompts.append({
                **item,
                "provider": "ready_asset",
                "provider_model": None,
                "submission_status": "not_applicable",
                "task_id": None,
                "task_state": None,
                "request_payload": None,
                "response_payload": None,
                "result_urls": [],
                "error": None,
            })
            continue

        try:
            submission = submit_kie_video_task(item["prompt_json"], model=model)
            enriched_prompts.append({
                **item,
                **submission,
            })
        except Exception as error:
            logger.error("Failed to submit KIE task for keyword '%s': %s", item.get("keyword"), error)
            enriched_prompts.append({
                **item,
                "provider": "kie.ai",
                "provider_model": normalize_kie_model(model),
                "submission_status": "failed",
                "task_id": None,
                "task_state": "fail",
                "request_payload": build_kie_request_payload(item["prompt_json"], model),
                "response_payload": None,
                "result_urls": [],
                "error": str(error),
            })

    return enriched_prompts


def submit_pending_kie_tasks_for_prompts(prompts: List[Dict[str, Any]], model: str | None = None) -> List[Dict[str, Any]]:
    enriched_prompts: List[Dict[str, Any]] = []

    for item in prompts or []:
        if item.get("use_ready_asset") or not item.get("prompt_json"):
            enriched_prompts.append({
                **item,
                "provider": item.get("provider") or "ready_asset",
                "provider_model": item.get("provider_model"),
                "submission_status": item.get("submission_status") or "not_applicable",
                "task_id": item.get("task_id"),
                "task_state": item.get("task_state"),
                "request_payload": item.get("request_payload"),
                "response_payload": item.get("response_payload"),
                "result_urls": item.get("result_urls") or [],
                "error": item.get("error"),
            })
            continue

        if item.get("task_id") or item.get("video_url"):
            enriched_prompts.append(item)
            continue

        try:
            submission = submit_kie_video_task(item["prompt_json"], model=model)
            enriched_prompts.append({
                **item,
                **submission,
            })
        except Exception as error:
            logger.error("Failed to submit KIE task for keyword '%s': %s", item.get("keyword"), error)
            enriched_prompts.append({
                **item,
                "provider": "kie.ai",
                "provider_model": normalize_kie_model(model),
                "submission_status": "failed",
                "task_id": None,
                "task_state": "fail",
                "request_payload": build_kie_request_payload(item["prompt_json"], model),
                "response_payload": None,
                "result_urls": [],
                "error": str(error),
            })

    return enriched_prompts


def get_kie_task_details(task_id: str) -> Dict[str, Any]:
    api_key = _get_api_key()
    if not api_key:
        raise ValueError("KIE_API_KEY is not configured")

    response = requests.get(
        KIE_RECORD_INFO_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        params={"taskId": task_id},
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def _parse_result_urls(result_json: Any) -> List[str]:
    if not result_json:
        return []
    payload = result_json
    if isinstance(result_json, str):
        try:
            payload = json.loads(result_json)
        except json.JSONDecodeError:
            return []
    if isinstance(payload, dict):
        result_urls = payload.get("resultUrls")
        if isinstance(result_urls, list):
            return [str(url) for url in result_urls if url]
    return []


def refresh_kie_prompt_status(item: Dict[str, Any]) -> Dict[str, Any]:
    if item.get("use_ready_asset") or not item.get("task_id"):
        return item

    try:
        response_payload = get_kie_task_details(str(item["task_id"]))
        data = (response_payload or {}).get("data") or {}
        task_state = data.get("state")
        result_urls = _parse_result_urls(data.get("resultJson"))
        fail_msg = data.get("failMsg") or data.get("failCode") or None

        return {
            **item,
            "provider": "kie.ai",
            "provider_model": item.get("provider_model") or data.get("model") or ((item.get("request_payload") or {}).get("model")),
            "submission_status": "completed" if task_state == "success" else ("failed" if task_state == "fail" else "submitted"),
            "task_state": task_state,
            "response_payload": response_payload,
            "result_urls": result_urls,
            "video_url": result_urls[0] if result_urls else None,
            "progress": data.get("progress"),
            "cost_time": data.get("costTime"),
            "create_time": data.get("createTime"),
            "update_time": data.get("updateTime"),
            "complete_time": data.get("completeTime"),
            "error": fail_msg,
        }
    except Exception as error:
        logger.error("Failed to refresh KIE task %s: %s", item.get("task_id"), error)
        return {
            **item,
            "provider": "kie.ai",
            "provider_model": item.get("provider_model"),
            "submission_status": "failed" if "404" in str(error) else item.get("submission_status", "submitted"),
            "error": str(error),
        }


def refresh_kie_tasks_for_prompts(prompts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [refresh_kie_prompt_status(item) for item in (prompts or [])]


def poll_kie_tasks_for_prompts(
    prompts: List[Dict[str, Any]],
    timeout_seconds: int = 600,
    initial_interval_seconds: float = 3.0,
    max_interval_seconds: float = 20.0,
) -> List[Dict[str, Any]]:
    deadline = time.time() + timeout_seconds
    interval = initial_interval_seconds
    current = prompts

    while time.time() < deadline:
        current = refresh_kie_tasks_for_prompts(current)
        pending = [
            item for item in current
            if not item.get("use_ready_asset")
            and item.get("task_id")
            and item.get("task_state") not in {"success", "fail"}
        ]
        if not pending:
            break
        time.sleep(interval)
        interval = min(interval * 1.5, max_interval_seconds)

    return current
