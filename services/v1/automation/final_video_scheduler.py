import logging
import os
import time

from dotenv import load_dotenv

load_dotenv(override=True)

from services.v1.database.db_service import enqueue_final_video_job, get_auto_final_video_client_stats, init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


def run_scheduler_cycle() -> int:
    clients = get_auto_final_video_client_stats()
    max_batch_per_client = max(1, int(os.getenv("FINAL_VIDEO_SCHEDULER_BATCH_PER_CLIENT", "1")))
    max_backlog_per_client = max(1, int(os.getenv("FINAL_VIDEO_QUEUE_BACKLOG_PER_CLIENT", "3")))
    queued = 0

    for client in clients:
        completed = int(client.get("monthly_final_video_count") or 0)
        open_jobs = int(client.get("open_final_video_jobs") or 0)
        limit = max(0, int(client.get("monthly_final_video_limit") or 0))

        if limit <= 0:
            continue

        remaining = max(0, limit - completed - open_jobs)
        backlog_room = max(0, max_backlog_per_client - open_jobs)
        to_enqueue = min(max_batch_per_client, remaining, backlog_room)

        for _ in range(to_enqueue):
            enqueue_final_video_job(int(client["id"]))
            queued += 1

        if to_enqueue:
            logger.info(
                "Queued %s final video jobs for client_id=%s (%s/%s completed this month, %s open)",
                to_enqueue,
                client["id"],
                completed,
                limit,
                open_jobs,
            )

    return queued


def main() -> None:
    init_db()
    sleep_seconds = max(10, int(os.getenv("FINAL_VIDEO_SCHEDULER_INTERVAL_SECONDS", "60")))
    logger.info("Final video scheduler started")

    while True:
        try:
            queued = run_scheduler_cycle()
            logger.info("Final video scheduler cycle completed. New jobs queued: %s", queued)
        except Exception:
            logger.exception("Final video scheduler cycle failed")
        time.sleep(sleep_seconds)


if __name__ == "__main__":
    main()
