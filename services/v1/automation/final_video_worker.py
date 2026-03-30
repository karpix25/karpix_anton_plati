import logging
import os
import socket
import time

from dotenv import load_dotenv

load_dotenv(override=True)

from services.v1.automation.final_video_automation import (
    handle_job_exception,
    process_avatar_submit_stage,
    process_montage_stage,
    process_scenario_stage,
)
from services.v1.database.db_service import claim_next_final_video_job, init_db, requeue_stale_final_video_jobs

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


def _worker_id() -> str:
    return f"final-video-worker:{socket.gethostname()}:{os.getpid()}"


def main() -> None:
    init_db()
    worker_id = _worker_id()
    lease_seconds = max(300, int(os.getenv("FINAL_VIDEO_WORKER_LEASE_SECONDS", "3600")))
    idle_sleep_seconds = max(2, int(os.getenv("FINAL_VIDEO_WORKER_IDLE_SECONDS", "10")))
    per_client_concurrency = max(1, int(os.getenv("FINAL_VIDEO_PER_CLIENT_CONCURRENCY", "1")))

    logger.info("Final video worker started: worker_id=%s", worker_id)

    while True:
        try:
            reclaimed = requeue_stale_final_video_jobs()
            if reclaimed:
                logger.warning("Requeued stale final video jobs: %s", reclaimed)

            job = claim_next_final_video_job(
                worker_id,
                allowed_stages=["scenario", "avatar_submit", "montage"],
                lease_seconds=lease_seconds,
                per_client_concurrency=per_client_concurrency,
            )

            if not job:
                time.sleep(idle_sleep_seconds)
                continue

            stage = str(job.get("current_stage") or "scenario")
            logger.info("Claimed final video job id=%s client_id=%s stage=%s", job["id"], job["client_id"], stage)

            if stage == "scenario":
                process_scenario_stage(job)
            elif stage == "avatar_submit":
                process_avatar_submit_stage(job)
            elif stage == "montage":
                process_montage_stage(job)
            else:
                raise RuntimeError(f"Unsupported worker stage: {stage}")
        except Exception as error:
            if "job" in locals() and job:
                logger.exception("Final video worker job failed: id=%s", job.get("id"))
                handle_job_exception(job, error)
            else:
                logger.exception("Final video worker loop failed")
                time.sleep(idle_sleep_seconds)


if __name__ == "__main__":
    main()
