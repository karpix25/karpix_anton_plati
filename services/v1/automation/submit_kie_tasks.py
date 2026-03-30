import argparse
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from dotenv import load_dotenv

load_dotenv(override=True)

from services.v1.database.db_service import get_generated_scenario_by_job_id, save_generated_scenario
from services.v1.providers.kie_ai_service import submit_pending_kie_tasks_for_prompts

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


def submit_saved_kie_tasks(job_id: str) -> Dict[str, Any]:
    scenario = get_generated_scenario_by_job_id(job_id)
    if not scenario:
        raise ValueError(f"Scenario with job_id={job_id} not found")

    prompts_payload = scenario.get("video_generation_prompts") or {}
    prompts = prompts_payload.get("prompts") or []
    if not prompts:
        raise ValueError("No video prompts found for this scenario")

    submitted_prompts = submit_pending_kie_tasks_for_prompts(prompts)
    refreshed_payload = {
        **prompts_payload,
        "prompts": submitted_prompts,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    save_generated_scenario(str(scenario["job_id"]), video_generation_prompts=refreshed_payload)

    submitted_count = sum(1 for item in submitted_prompts if item.get("task_id"))
    pending_count = sum(
        1
        for item in submitted_prompts
        if not item.get("use_ready_asset")
        and item.get("task_id")
        and item.get("task_state") not in {"success", "fail"}
    )

    result = {
        "job_id": scenario["job_id"],
        "scenario_id": scenario["id"],
        "prompts_total": len(submitted_prompts),
        "submitted_count": submitted_count,
        "pending_count": pending_count,
    }
    logger.info("Submitted KIE tasks for scenario_id=%s job_id=%s", scenario["id"], scenario["job_id"])
    return result


def submitSavedKieTasks(jobId: str) -> Dict[str, Any]:
    return submit_saved_kie_tasks(job_id=jobId)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Submit saved Seedance prompts to KIE and save task ids back to generated_scenarios.")
    parser.add_argument("--job-id", type=str, required=True, help="job_id for a single scenario.")
    args = parser.parse_args()

    result = submit_saved_kie_tasks(job_id=args.job_id)
    logger.info("Submit finished for scenario_id=%s", result["scenario_id"])
