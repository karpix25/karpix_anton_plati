import logging
import os
import time
from typing import Any, Optional

from dotenv import load_dotenv

load_dotenv(override=True)

from services.v1.database.db_service import enqueue_final_video_job, get_auto_final_video_client_stats, get_db_connection, init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)
SCHEDULER_ADVISORY_LOCK_KEY = 84244001


def _acquire_scheduler_lock() -> Optional[Any]:
    conn = get_db_connection()
    conn.autocommit = True
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT pg_try_advisory_lock(%s)", (SCHEDULER_ADVISORY_LOCK_KEY,))
        row = cursor.fetchone()
        locked = bool(row[0]) if row else False
    finally:
        cursor.close()

    if not locked:
        conn.close()
        return None

    return conn


def _release_scheduler_lock(conn: Optional[Any]) -> None:
    if conn is None:
        return

    cursor = conn.cursor()
    try:
        cursor.execute("SELECT pg_advisory_unlock(%s)", (SCHEDULER_ADVISORY_LOCK_KEY,))
    finally:
        cursor.close()
        conn.close()


def run_scheduler_cycle() -> int:
    lock_conn = _acquire_scheduler_lock()
    if lock_conn is None:
        logger.info("Skipped scheduler cycle: advisory lock is held by another scheduler instance.")
        return 0

    try:
        clients = get_auto_final_video_client_stats()
        max_batch_per_client = max(1, int(os.getenv("FINAL_VIDEO_SCHEDULER_BATCH_PER_CLIENT", "1")))
        max_backlog_per_client = max(1, int(os.getenv("FINAL_VIDEO_QUEUE_BACKLOG_PER_CLIENT", "3")))
        queued = 0

        for client in clients:
            completed_today = int(client.get("daily_final_video_count") or 0)
            completed = int(client.get("monthly_final_video_count") or 0)
            open_jobs = int(client.get("open_final_video_jobs") or 0)
            daily_job_count = int(client.get("daily_final_video_jobs") or 0)
            monthly_job_count = int(client.get("monthly_final_video_jobs") or 0)
            daily_limit = max(0, int(client.get("daily_final_video_limit") or 0))
            limit = max(0, int(client.get("monthly_final_video_limit") or 0))

            if limit <= 0 or daily_limit <= 0:
                continue

            # Hard cap by number of auto-jobs created in this day/month so the
            # scenario volume matches configured limits even under retries/failures.
            remaining_today = max(0, daily_limit - daily_job_count)
            remaining_month = max(0, limit - monthly_job_count)
            remaining = min(remaining_today, remaining_month)
            backlog_room = max(0, max_backlog_per_client - open_jobs)
            to_enqueue = min(max_batch_per_client, remaining, backlog_room)

            for _ in range(to_enqueue):
                enqueue_final_video_job(int(client["id"]))
                queued += 1

            if to_enqueue:
                logger.info(
                    (
                        "Queued %s final video jobs for client_id=%s "
                        "(created jobs today: %s/%s, created jobs month: %s/%s, completed today: %s, completed month: %s, open: %s)"
                    ),
                    to_enqueue,
                    client["id"],
                    daily_job_count,
                    daily_limit,
                    monthly_job_count,
                    limit,
                    completed_today,
                    completed,
                    open_jobs,
                )

        return queued
    finally:
        _release_scheduler_lock(lock_conn)


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
