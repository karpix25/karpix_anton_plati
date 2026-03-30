import logging
import os
from datetime import datetime
from typing import Any, Dict, Optional

import requests
from dotenv import load_dotenv

load_dotenv(override=True)

from services.v1.automation.batch_generator import run_batch_generation
from services.v1.automation.poll_kie_tasks import poll_saved_kie_tasks
from services.v1.automation.submit_kie_tasks import submit_saved_kie_tasks
from services.v1.database.db_service import (
    complete_final_video_job,
    get_final_video_job,
    get_generated_scenario_by_job_id,
    requeue_final_video_job,
    update_final_video_job,
)

logger = logging.getLogger(__name__)

DEFAULT_INTERNAL_API_BASE_URL = "http://127.0.0.1:3000"
DEFAULT_KIE_POLL_INTERVAL_SECONDS = 30
DEFAULT_HEYGEN_POLL_INTERVAL_SECONDS = 30


def get_internal_api_base_url() -> str:
    return (os.getenv("INTERNAL_API_BASE_URL") or DEFAULT_INTERNAL_API_BASE_URL).rstrip("/")


def get_kie_poll_interval_seconds() -> int:
    return max(10, int(os.getenv("FINAL_VIDEO_KIE_POLL_INTERVAL_SECONDS", str(DEFAULT_KIE_POLL_INTERVAL_SECONDS))))


def get_heygen_poll_interval_seconds() -> int:
    return max(10, int(os.getenv("FINAL_VIDEO_HEYGEN_POLL_INTERVAL_SECONDS", str(DEFAULT_HEYGEN_POLL_INTERVAL_SECONDS))))


def get_retry_delay_seconds(attempt_count: int) -> int:
    base = max(15, int(os.getenv("FINAL_VIDEO_RETRY_BASE_SECONDS", "30")))
    ceiling = max(base, int(os.getenv("FINAL_VIDEO_RETRY_MAX_SECONDS", "1800")))
    return min(base * max(1, attempt_count), ceiling)


def _build_internal_headers() -> Dict[str, str]:
    headers: Dict[str, str] = {}
    token = (os.getenv("AUTOMATION_INTERNAL_TOKEN") or "").strip()
    if token:
        headers["x-automation-token"] = token
    return headers


def _internal_request(method: str, path: str, **kwargs: Any) -> Dict[str, Any]:
    response = requests.request(
        method,
        f"{get_internal_api_base_url()}{path}",
        headers={**_build_internal_headers(), **kwargs.pop("headers", {})},
        timeout=kwargs.pop("timeout", 300),
        **kwargs,
    )

    try:
        payload = response.json()
    except ValueError:
        payload = {"error": response.text}

    if not response.ok:
        raise RuntimeError(str(payload.get("error") or f"Internal API {path} failed with status {response.status_code}"))

    return payload


def _scenario_has_pending_kie_tasks(scenario: Dict[str, Any]) -> bool:
    prompts = ((scenario.get("video_generation_prompts") or {}).get("prompts") or [])
    for item in prompts:
        if item.get("use_ready_asset"):
            continue
        if item.get("task_id") and item.get("task_state") not in {"success", "fail"}:
            return True
        if item.get("prompt_json") and not item.get("task_id") and not item.get("video_url") and not item.get("use_ready_asset"):
            return True
    return False


def process_scenario_stage(job: Dict[str, Any]) -> None:
    results = run_batch_generation(count=1, client_id=int(job["client_id"]), mode="mix")
    if not results:
        raise RuntimeError("Scenario generation returned no results")

    scenario_job_id = str(results[0]["job_id"])
    scenario = get_generated_scenario_by_job_id(scenario_job_id)
    if not scenario:
        raise RuntimeError(f"Generated scenario with job_id={scenario_job_id} was not found in DB")

    submit_result = submit_saved_kie_tasks(scenario_job_id)
    next_stage = "waiting_kie" if submit_result.get("pending_count", 0) > 0 else "avatar_submit"
    next_schedule = datetime.utcnow()

    update_final_video_job(
        int(job["id"]),
        status="queued",
        current_stage=next_stage,
        scenario_id=scenario["id"],
        scenario_job_id=scenario_job_id,
        scheduled_for=next_schedule,
        lease_until=None,
        worker_id=None,
        last_error=None,
    )


def poll_waiting_kie_stage(job: Dict[str, Any]) -> None:
    scenario_job_id = job.get("scenario_job_id")
    if not scenario_job_id:
        raise RuntimeError("Final video job has no scenario_job_id")

    poll_saved_kie_tasks(job_id=str(scenario_job_id), limit=1)
    scenario = get_generated_scenario_by_job_id(str(scenario_job_id))
    if not scenario:
        raise RuntimeError(f"Scenario with job_id={scenario_job_id} not found")

    if _scenario_has_pending_kie_tasks(scenario):
        requeue_final_video_job(
            int(job["id"]),
            stage="waiting_kie",
            delay_seconds=get_kie_poll_interval_seconds(),
            error_message=None,
        )
        return

    update_final_video_job(
        int(job["id"]),
        status="queued",
        current_stage="avatar_submit",
        scenario_id=scenario["id"],
        scheduled_for=datetime.utcnow(),
        lease_until=None,
        worker_id=None,
        last_error=None,
    )


def process_avatar_submit_stage(job: Dict[str, Any]) -> None:
    scenario_id = job.get("scenario_id")
    if not scenario_id:
        raise RuntimeError("Final video job has no scenario_id")

    payload = _internal_request("POST", "/api/heygen/avatar-video", json={"scenarioId": int(scenario_id)}, timeout=600)
    stage = "montage" if str(payload.get("status") or "").lower() in {"completed", "success"} else "waiting_heygen"
    delay_seconds = 0 if stage == "montage" else get_heygen_poll_interval_seconds()

    requeue_final_video_job(
        int(job["id"]),
        stage=stage,
        delay_seconds=delay_seconds,
        error_message=None,
    )


def poll_waiting_heygen_stage(job: Dict[str, Any]) -> None:
    scenario_id = job.get("scenario_id")
    if not scenario_id:
        raise RuntimeError("Final video job has no scenario_id")

    payload = _internal_request("GET", f"/api/heygen/avatar-video?scenarioId={int(scenario_id)}", timeout=180)
    status = str(payload.get("status") or "").lower()

    if status in {"completed", "success"} and payload.get("videoUrl"):
        requeue_final_video_job(int(job["id"]), stage="montage", delay_seconds=0, error_message=None)
        return

    if status == "failed":
        raise RuntimeError(str(payload.get("error") or "HeyGen avatar generation failed"))

    requeue_final_video_job(
        int(job["id"]),
        stage="waiting_heygen",
        delay_seconds=get_heygen_poll_interval_seconds(),
        error_message=None,
    )


def process_montage_stage(job: Dict[str, Any]) -> None:
    scenario_id = job.get("scenario_id")
    if not scenario_id:
        raise RuntimeError("Final video job has no scenario_id")

    payload = _internal_request("POST", "/api/scenarios/assemble", json={"scenarioId": int(scenario_id)}, timeout=1800)
    yandex_status = str(payload.get("montage_yandex_status") or "").lower()
    yandex_error = payload.get("montage_yandex_error")

    if yandex_status == "failed" and (os.getenv("YANDEX_DISK_OAUTH_TOKEN") or os.getenv("YANDEX_DISK_TOKEN")):
        raise RuntimeError(str(yandex_error or "Yandex Disk upload failed"))

    complete_final_video_job(int(job["id"]))


def handle_job_exception(job: Dict[str, Any], error: Exception) -> None:
    fresh_job = get_final_video_job(int(job["id"])) or job
    attempts = int(fresh_job.get("attempt_count") or 0)
    max_attempts = int(fresh_job.get("max_attempts") or 6)
    message = str(error)

    if attempts >= max_attempts:
        update_final_video_job(
            int(job["id"]),
            lease_until=None,
            worker_id=None,
        )
        from services.v1.database.db_service import fail_final_video_job

        fail_final_video_job(int(job["id"]), message)
        return

    requeue_final_video_job(
        int(job["id"]),
        stage=str(fresh_job.get("current_stage") or "scenario"),
        delay_seconds=get_retry_delay_seconds(attempts),
        error_message=message,
    )
