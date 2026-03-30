import argparse
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from dotenv import load_dotenv

load_dotenv(override=True)

from services.v1.database.db_service import (
    get_generated_scenario_by_job_id,
    get_generated_scenarios_with_kie_tasks,
    save_generated_scenario,
)
from services.v1.providers.kie_ai_service import refresh_kie_tasks_for_prompts

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


def _has_pending_kie_tasks(prompts_payload: Dict[str, Any] | None) -> bool:
    prompts = (prompts_payload or {}).get("prompts") or []
    for item in prompts:
        if item.get("use_ready_asset"):
            continue
        if item.get("task_id") and item.get("task_state") not in {"success", "fail"}:
            return True
    return False


def poll_saved_kie_tasks(job_id: str | None = None, limit: int = 100) -> List[Dict[str, Any]]:
    scenarios = [get_generated_scenario_by_job_id(job_id)] if job_id else get_generated_scenarios_with_kie_tasks(limit=limit)
    updated: List[Dict[str, Any]] = []

    for scenario in scenarios:
        if not scenario:
            continue
        prompts_payload = scenario.get("video_generation_prompts") or {}
        if not _has_pending_kie_tasks(prompts_payload):
            continue

        refreshed_prompts = refresh_kie_tasks_for_prompts(prompts_payload.get("prompts") or [])
        refreshed_payload = {
            **prompts_payload,
            "prompts": refreshed_prompts,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        save_generated_scenario(str(scenario["job_id"]), video_generation_prompts=refreshed_payload)
        updated.append({
            "job_id": scenario["job_id"],
            "scenario_id": scenario["id"],
            "prompts_updated": len(refreshed_prompts),
        })
        logger.info("Updated KIE tasks for scenario_id=%s job_id=%s", scenario["id"], scenario["job_id"])

    return updated


def pollSavedKieTasks(jobId: str | None = None, limit: int = 100) -> List[Dict[str, Any]]:
    return poll_saved_kie_tasks(job_id=jobId, limit=limit)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Refresh KIE task states and save them back to generated_scenarios.")
    parser.add_argument("--job-id", type=str, default=None, help="Optional job_id for a single scenario.")
    parser.add_argument("--limit", type=int, default=100, help="How many recent scenarios to scan.")
    args = parser.parse_args()

    results = poll_saved_kie_tasks(job_id=args.job_id, limit=args.limit)
    logger.info("Polling finished. Updated scenarios: %s", len(results))
