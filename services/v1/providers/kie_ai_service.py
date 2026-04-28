import json
import logging
import os
import time
from typing import Any, Dict, List

import requests
from requests.exceptions import HTTPError

logger = logging.getLogger(__name__)

KIE_CREATE_TASK_URL = "https://api.kie.ai/api/v1/jobs/createTask"
KIE_RECORD_INFO_URL = "https://api.kie.ai/api/v1/jobs/recordInfo"
KIE_VEO_GENERATE_URL = "https://api.kie.ai/api/v1/veo/generate"
KIE_VEO_RECORD_INFO_URL = "https://api.kie.ai/api/v1/veo/record-info"
DEFAULT_KIE_MODEL = "veo3_lite"
SEEDANCE_15_PRO_MODEL = "bytedance/seedance-1.5-pro"
GROK_IMAGINE_TEXT_TO_VIDEO_MODEL = "grok-imagine/text-to-video"
VEO3_QUALITY = "veo3"
VEO3_FAST = "veo3_fast"
VEO3_LITE = "veo3_lite"
KIE_RETRYABLE_ERROR_CODES = {500}
SUPPORTED_KIE_MODELS = {
    DEFAULT_KIE_MODEL,
    SEEDANCE_15_PRO_MODEL,
    GROK_IMAGINE_TEXT_TO_VIDEO_MODEL,
    VEO3_QUALITY,
    VEO3_FAST,
    VEO3_LITE,
}

VIDEO_URL_HINTS = (".mp4", ".mov", ".webm", ".m4v", ".mkv", ".avi", ".ts", ".m3u8")
IMAGE_URL_HINTS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif", ".svg")
VEO3_MODELS = {VEO3_QUALITY, VEO3_FAST, VEO3_LITE}


def _get_api_key() -> str | None:
    return os.getenv("KIE_API_KEY") or os.getenv("KIE_AI_API_KEY")


def _get_max_internal_retry_attempts() -> int:
    return max(0, int(os.getenv("KIE_INTERNAL_RETRY_ATTEMPTS", "3")))


def _get_internal_retry_delay_seconds() -> float:
    return max(0.0, float(os.getenv("KIE_INTERNAL_RETRY_DELAY_SECONDS", "1.5")))


def _get_max_resubmit_attempts() -> int:
    raw_value = (
        os.getenv("KIE_RESUBMIT_ATTEMPTS")
        or os.getenv("FINAL_VIDEO_KIE_RESUBMIT_ATTEMPTS")
        or "3"
    )
    return max(1, int(raw_value))


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


def _to_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _is_retryable_internal_error(error_code: int | None, error_message: str | None) -> bool:
    if error_code in KIE_RETRYABLE_ERROR_CODES:
        return True
    return "internal error" in str(error_message or "").lower()


def _flatten_prompt_json_to_text(prompt_json: Any) -> str:
    """Convert a structured prompt_json object into a plain-text prompt
    string that KIE API expects.

    KIE API's `prompt` field must be a human-readable cinematic
    description.  This function extracts the visual description
    and camera direction, prioritizing the scene action (which
    contains the most valuable visual information for the model).

    If prompt_json is already a plain string, it is returned as-is.
    """
    if isinstance(prompt_json, str):
        return prompt_json.strip()

    if not isinstance(prompt_json, dict):
        return json.dumps(prompt_json, ensure_ascii=False)

    # 0. Check for explicit "full_prompt" or "prompt" field which might already be flat
    for key in ("full_prompt", "prompt", "text"):
        val = prompt_json.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()

    parts: list[str] = []

    # 1. Scene description — this is the CORE of the prompt
    #    The action field should contain the rich cinematic description
    scenes = prompt_json.get("scene_sequencing")
    if isinstance(scenes, list):
        for scene in scenes:
            if not isinstance(scene, dict):
                continue
            # Action is the primary visual description
            action = scene.get("action")
            if action:
                # Prepend location if it adds specificity
                location = scene.get("location")
                if location and location.lower() not in str(action).lower():
                    parts.append(f"{str(location).strip()}. {str(action).strip()}")
                else:
                    parts.append(str(action).strip())

    # 2. Camera movement — only if it describes a specific physical action
    tech = prompt_json.get("technical_directives")
    if isinstance(tech, dict):
        cam = tech.get("camera_movement")
        if cam and not any(skip in str(cam).lower() for skip in ("handheld smartphone", "subtle natural micro-jitter")):
            parts.append(str(cam).strip())
        # Framing only if it's specific (not generic labels)
        framing = tech.get("framing")
        if framing and not any(skip in str(framing).lower() for skip in ("portrait-safe", "central subject dominance")):
            parts.append(str(framing).strip())

    # 3. Global logic — only if scene description is missing or very short
    if not parts or sum(len(p) for p in parts) < 50:
        global_logic = prompt_json.get("global_logic")
        if global_logic:
            parts.insert(0, str(global_logic).strip())

    # NOTE: Negative prompt is intentionally excluded from the main text.
    # KIE models don't have a separate negative prompt field, and including
    # "Negative prompt: stock footage..." in the main prompt can confuse
    # the model into PRODUCING stock-looking footage.

    result = " ".join(parts).strip()
    if not result:
        # Fallback to json.dumps but without logging a warning if it's just a tiny object
        if len(prompt_json) > 1:
            logger.warning("_flatten_prompt_json_to_text: could not extract text, falling back to json.dumps for keys: %s", list(prompt_json.keys()))
        result = json.dumps(prompt_json, ensure_ascii=False)

    return result


def build_kie_request_payload(prompt_json: Dict[str, Any], model: str | None = None) -> Dict[str, Any]:
    resolved_model = normalize_kie_model(model)
    prompt_text = _flatten_prompt_json_to_text(prompt_json)

    if resolved_model == SEEDANCE_15_PRO_MODEL:
        return {
            "model": resolved_model,
            "input": {
                "prompt": prompt_text,
                "aspect_ratio": "9:16",
                "resolution": "720p",
                "duration": "8",
                "fixed_lens": False,
                "generate_audio": False,
                "nsfw_checker": False,
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
            "nsfw_checker": False,
        },
    }


def submit_veo_video_task(prompt_json: Dict[str, Any], model: str | None = None) -> Dict[str, Any]:
    api_key = _get_api_key()
    resolved_model = normalize_kie_model(model)
    prompt_text = _flatten_prompt_json_to_text(prompt_json)

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

    # Capture response body BEFORE raise_for_status so we can log KIE error details
    response_payload = None
    try:
        response_payload = response.json()
    except Exception:
        response_payload = {"raw": response.text}

    if not response.ok:
        error_detail = _extract_error_message(response_payload) or response.text[:500]
        
        # --- FALLBACK LOGIC ---
        # If Veo returns 500, automatically switch to Seedance 1.5 Pro
        if response.status_code == 500:
            logger.warning(
                "KIE VEO returned 500. Automatically falling back to Seedance 1.5 Pro. "
                "model=%s error=%s", resolved_model, error_detail
            )
            # Recursively call submit_kie_video_task with the fallback model.
            # This works because SEEDANCE_15_PRO_MODEL is not in VEO3_MODELS.
            return submit_kie_video_task(prompt_json, model=SEEDANCE_15_PRO_MODEL)

        logger.error(
            "KIE VEO submission failed. status=%s model=%s error=%s payload_sent=%s response=%s",
            response.status_code,
            resolved_model,
            error_detail,
            json.dumps(payload, ensure_ascii=False)[:500],
            json.dumps(response_payload, ensure_ascii=False)[:500] if response_payload else "<empty>",
        )
        return {
            "provider": "kie.ai",
            "provider_model": resolved_model,
            "submission_status": "failed",
            "task_id": None,
            "task_state": "fail",
            "request_payload": payload,
            "response_payload": response_payload,
            "result_urls": [],
            "error": f"HTTP {response.status_code}: {error_detail}",
        }

    task_id = _extract_task_id(response_payload)
    error_message = None
    if not task_id:
        error_message = _extract_error_message(response_payload)

    is_submitted = bool(task_id)
    return {
        "provider": "kie.ai",
        "provider_model": resolved_model,
        "submission_status": "submitted" if is_submitted else "failed",
        "task_id": task_id,
        "task_state": "waiting" if is_submitted else "fail",
        "request_payload": payload,
        "response_payload": response_payload,
        "result_urls": [],
        "error": None if is_submitted else (error_message or "Task submitted but taskId missing in response"),
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

    logger.info(
        "KIE createTask request: model=%s prompt_preview=%s",
        resolved_model,
        json.dumps(payload, ensure_ascii=False)[:300],
    )

    response = requests.post(
        KIE_CREATE_TASK_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=60,
    )

    # Capture response body BEFORE raise_for_status so we can log KIE error details
    response_payload = None
    response_text = None
    try:
        response_payload = response.json()
    except Exception:
        response_text = response.text
        response_payload = {"raw": response_text}

    if not response.ok:
        error_detail = _extract_error_message(response_payload) or response_text or response.text[:500]
        logger.error(
            "KIE createTask FAILED. status=%s model=%s error=%s payload_sent=%s response=%s",
            response.status_code,
            resolved_model,
            error_detail,
            json.dumps(payload, ensure_ascii=False)[:500],
            json.dumps(response_payload, ensure_ascii=False)[:500] if response_payload else "<empty>",
        )
        return {
            "provider": "kie.ai",
            "provider_model": resolved_model,
            "submission_status": "failed",
            "task_id": None,
            "task_state": "fail",
            "request_payload": payload,
            "response_payload": response_payload,
            "result_urls": [],
            "error": f"HTTP {response.status_code}: {error_detail}",
        }

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

    logger.info(
        "KIE createTask OK: model=%s task_id=%s state=%s",
        resolved_model,
        task_id,
        "waiting" if task_id else "unknown",
    )

    is_submitted = bool(task_id)
    return {
        "provider": "kie.ai",
        "provider_model": resolved_model,
        "submission_status": "submitted" if is_submitted else "failed",
        "task_id": task_id,
        "task_state": "waiting" if is_submitted else "fail",
        "request_payload": payload,
        "response_payload": response_payload,
        "result_urls": [],
        "error": None if is_submitted else (error_message or "Task submitted but taskId missing in response"),
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
    max_resubmit_attempts = _get_max_resubmit_attempts()

    for item in prompts or []:
        resubmit_attempts = max(0, _to_int(item.get("resubmit_attempts")) or 0)
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
                "resubmit_attempts": resubmit_attempts,
                "max_resubmit_attempts": max_resubmit_attempts,
            })
            continue

        has_video = bool(item.get("video_url"))
        has_task_id = bool(item.get("task_id"))
        task_state = str(item.get("task_state") or "").lower()
        submission_status = str(item.get("submission_status") or "").lower()
        failed_task = task_state == "fail" or submission_status == "failed"

        if has_video:
            enriched_prompts.append({
                **item,
                "resubmit_attempts": resubmit_attempts,
                "max_resubmit_attempts": max_resubmit_attempts,
            })
            continue

        # Allow retry for failed tasks even when stale task_id is still present.
        if has_task_id and not failed_task:
            enriched_prompts.append({
                **item,
                "resubmit_attempts": resubmit_attempts,
                "max_resubmit_attempts": max_resubmit_attempts,
            })
            continue

        if resubmit_attempts >= max_resubmit_attempts:
            enriched_prompts.append({
                **item,
                "task_id": None if not has_video else item.get("task_id"),
                "submission_status": "failed",
                "task_state": "fail",
                "error": item.get("error") or f"Exceeded KIE re-submit limit ({max_resubmit_attempts})",
                "resubmit_attempts": resubmit_attempts,
                "max_resubmit_attempts": max_resubmit_attempts,
            })
            continue

        try:
            submission = submit_kie_video_task(item["prompt_json"], model=model)
            next_attempts = resubmit_attempts + 1
            submission_task_id = submission.get("task_id")
            submission_error = submission.get("error")
            enriched_prompts.append({
                **item,
                **submission,
                "submission_status": "submitted" if submission_task_id else "failed",
                "task_state": "waiting" if submission_task_id else "fail",
                "error": None if submission_task_id else (submission_error or "Task submitted but taskId missing in response"),
                "resubmit_attempts": next_attempts,
                "max_resubmit_attempts": max_resubmit_attempts,
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
                "resubmit_attempts": resubmit_attempts + 1,
                "max_resubmit_attempts": max_resubmit_attempts,
            })

    return enriched_prompts


def _is_veo3_model(model: str | None) -> bool:
    """Check if the model is a Veo 3.1 model (uses different API endpoints)."""
    return str(model or "").strip() in VEO3_MODELS


def get_kie_task_details(task_id: str, model: str | None = None) -> Dict[str, Any]:
    """Fetch task details from the correct KIE endpoint based on model type."""
    api_key = _get_api_key()
    if not api_key:
        raise ValueError("KIE_API_KEY is not configured")

    # Veo 3.1 uses a different endpoint
    url = KIE_VEO_RECORD_INFO_URL if _is_veo3_model(model) else KIE_RECORD_INFO_URL

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {api_key}"},
        params={"taskId": task_id},
        timeout=60,
    )

    try:
        payload = response.json()
    except Exception:
        payload = {"raw": response.text}

    if not response.ok:
        error_msg = payload.get("msg") or payload.get("message") or response.text[:300]
        logger.warning(
            "KIE recordInfo failed: task_id=%s model=%s url=%s status=%s msg=%s",
            task_id, model, url, response.status_code, error_msg,
        )
        raise RuntimeError(f"KIE recordInfo HTTP {response.status_code}: {error_msg}")

    # Also check for API-level error code inside the 200 response
    api_code = payload.get("code")
    if api_code and str(api_code) not in {"0", "200", "success"}:
        error_msg = payload.get("msg") or payload.get("message") or f"code={api_code}"
        logger.warning(
            "KIE recordInfo API error: task_id=%s code=%s msg=%s",
            task_id, api_code, error_msg,
        )
        raise RuntimeError(f"KIE recordInfo code={api_code}: {error_msg}")

    return payload


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


def _pick_preferred_video_url(urls: List[str]) -> str | None:
    normalized = [str(url or "").strip() for url in (urls or []) if str(url or "").strip()]
    if not normalized:
        return None

    def _looks_like_by_hints(url: str, hints: tuple[str, ...]) -> bool:
        lower = url.lower()
        return any(hint in lower for hint in hints)

    for url in normalized:
        if _looks_like_by_hints(url, VIDEO_URL_HINTS):
            return url

    for url in normalized:
        if not _looks_like_by_hints(url, IMAGE_URL_HINTS):
            return url

    return normalized[0]


def _parse_veo3_task_state(data: Dict[str, Any]) -> tuple[str, List[str], str | None]:
    """Parse Veo 3.1 response format into (task_state, result_urls, fail_msg).

    Veo 3.1 uses successFlag:
      0 = generating, 1 = success, 2 = failed, 3 = generation failed
    """
    success_flag = data.get("successFlag")

    if success_flag == 1:
        task_state = "success"
    elif success_flag in {2, 3}:
        task_state = "fail"
    elif success_flag == 0:
        task_state = "processing"
    else:
        task_state = "waiting"

    # Extract result URLs from response object
    result_urls: List[str] = []
    response_obj = data.get("response")
    if isinstance(response_obj, dict):
        for key in ("resultUrls", "fullResultUrls", "originUrls"):
            urls = response_obj.get(key)
            if isinstance(urls, list):
                result_urls.extend(str(u) for u in urls if u)
            if result_urls:
                break  # Use first non-empty list

    fail_msg = data.get("errorMessage") or None
    if not fail_msg and success_flag in {2, 3}:
        error_code = data.get("errorCode")
        fail_msg = f"Veo3 generation failed (errorCode={error_code})" if error_code else "Veo3 generation failed"

    return task_state, result_urls, fail_msg


def _parse_market_task_state(data: Dict[str, Any]) -> tuple[str, List[str], str | None]:
    """Parse Market API (Seedance, V1 Pro, Grok) response format."""
    task_state = data.get("state")
    result_urls = _parse_result_urls(data.get("resultJson"))
    fail_msg = data.get("failMsg") or data.get("failCode") or None
    return task_state, result_urls, fail_msg


def refresh_kie_prompt_status(item: Dict[str, Any]) -> Dict[str, Any]:
    if item.get("use_ready_asset") or not item.get("task_id"):
        return item

    model = item.get("provider_model") or (item.get("request_payload") or {}).get("model")
    retry_attempts = max(0, _to_int(item.get("retry_attempts")) or 0)
    max_retry_attempts = max(0, _to_int(item.get("max_retry_attempts")) or _get_max_internal_retry_attempts())

    try:
        response_payload = get_kie_task_details(str(item["task_id"]), model=model)
        data = (response_payload or {}).get("data") or {}

        # Route to correct parser based on model
        if _is_veo3_model(model):
            task_state, result_urls, fail_msg = _parse_veo3_task_state(data)
        else:
            task_state, result_urls, fail_msg = _parse_market_task_state(data)
        error_code = _to_int(data.get("errorCode"))

        if (
            task_state == "fail"
            and item.get("prompt_json")
            and retry_attempts < max_retry_attempts
            and _is_retryable_internal_error(error_code, fail_msg)
        ):
            next_attempt = retry_attempts + 1
            
            # AUTOMATIC FALLBACK: If Veo 3.1 fails with 500, switch to Seedance for the retry
            retry_model = model
            if _is_veo3_model(model) and (error_code == 500 or "internal error" in str(fail_msg).lower()):
                retry_model = SEEDANCE_15_PRO_MODEL
                logger.info(
                    "KIE FALLBACK TRIGGERED: Switching task_id=%s from Veo to Seedance due to error 500",
                    item.get("task_id")
                )

            logger.warning(
                "KIE task failed with retryable internal error. task_id=%s model=%s -> retry_model=%s "
                "error_code=%s attempt=%s/%s fail=%s",
                item.get("task_id"), model, retry_model, error_code, next_attempt, max_retry_attempts, fail_msg,
            )
            
            retry_delay = _get_internal_retry_delay_seconds()
            if retry_delay > 0:
                time.sleep(retry_delay)
            
            submission = submit_kie_video_task(item["prompt_json"], model=retry_model)
            retry_error = submission.get("error")
            if retry_error:
                logger.warning(
                    "KIE retry submission failed immediately. previous_task_id=%s attempt=%s/%s error=%s",
                    item.get("task_id"), next_attempt, max_retry_attempts, retry_error,
                )
            else:
                logger.info(
                    "KIE retry submission accepted. previous_task_id=%s new_task_id=%s model=%s attempt=%s/%s",
                    item.get("task_id"), submission.get("task_id"), retry_model, next_attempt, max_retry_attempts,
                )
            return {
                **item,
                **submission,
                "retry_attempts": next_attempt,
                "max_retry_attempts": max_retry_attempts,
            }

        logger.info(
            "KIE task refresh: task_id=%s model=%s state=%s urls=%d fail=%s",
            item.get("task_id"), model, task_state, len(result_urls), fail_msg,
        )

        return {
            **item,
            "provider": "kie.ai",
            "provider_model": model or data.get("model"),
            "submission_status": "completed" if task_state == "success" else ("failed" if task_state == "fail" else "submitted"),
            "task_state": task_state,
            "response_payload": response_payload,
            "result_urls": result_urls,
            "video_url": _pick_preferred_video_url(result_urls),
            "progress": data.get("progress"),
            "cost_time": data.get("costTime"),
            "create_time": data.get("createTime") or data.get("completeTime"),
            "update_time": data.get("updateTime"),
            "complete_time": data.get("completeTime"),
            "error": fail_msg,
            "retry_attempts": retry_attempts,
            "max_retry_attempts": max_retry_attempts,
        }
    except Exception as error:
        error_str = str(error)
        # KIE returns 404 or 422 "recordInfo is null" for tasks that no longer exist
        task_not_found = any(marker in error_str for marker in ("404", "422", "recordInfo is null", "record is null"))
        logger.error(
            "Failed to refresh KIE task %s model=%s (not_found=%s): %s",
            item.get("task_id"), model, task_not_found, error,
        )
        if task_not_found:
            return {
                **item,
                "provider": "kie.ai",
                "provider_model": item.get("provider_model"),
                "submission_status": "failed",
                "task_id": None,  # Clear so retry logic can re-submit
                "task_state": "fail",
                "error": error_str,
                "retry_attempts": retry_attempts,
                "max_retry_attempts": max_retry_attempts,
            }
        return {
            **item,
            "provider": "kie.ai",
            "provider_model": item.get("provider_model"),
            "submission_status": item.get("submission_status", "submitted"),
            "error": error_str,
            "retry_attempts": retry_attempts,
            "max_retry_attempts": max_retry_attempts,
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
