from typing import Any, Dict

from services.v1.automation.final_video_config import get_kie_poll_interval_seconds
from services.v1.automation.submit_kie_tasks import submit_saved_kie_tasks
from services.v1.database.db_service import requeue_final_video_job


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def queue_after_heygen_completed(job: Dict[str, Any]) -> None:
    scenario_job_id = str(job.get("scenario_job_id") or "").strip()
    if not scenario_job_id:
        raise RuntimeError("Final video job has no scenario_job_id")

    submit_result = submit_saved_kie_tasks(scenario_job_id)
    if submit_result.get("has_payment_error"):
        raise RuntimeError(f"KIE payment error: {submit_result.get('payment_error') or 'unknown payment issue'}")

    prompts_total = _safe_int(submit_result.get("prompts_total"), 0)
    ready_asset_count = _safe_int(submit_result.get("ready_asset_count"), 0)
    submitted_count = _safe_int(submit_result.get("submitted_count"), 0)
    pending_count = _safe_int(submit_result.get("pending_count"), 0)
    failed_count = _safe_int(submit_result.get("failed_count"), 0)

    if pending_count > 0:
        requeue_final_video_job(
            int(job["id"]),
            stage="waiting_kie",
            delay_seconds=get_kie_poll_interval_seconds(),
            error_message=None,
        )
        return

    if (prompts_total - ready_asset_count) > 0 and submitted_count == 0:
        raise RuntimeError(
            "KIE submission failed without tasks. "
            f"total={prompts_total} ready_asset={ready_asset_count} failed={failed_count}"
        )

    requeue_final_video_job(int(job["id"]), stage="montage", delay_seconds=0, error_message=None)
