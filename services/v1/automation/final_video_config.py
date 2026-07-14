import os


DEFAULT_KIE_POLL_INTERVAL_SECONDS = 30
DEFAULT_HEYGEN_POLL_INTERVAL_SECONDS = 30


def get_kie_poll_interval_seconds() -> int:
    return max(10, int(os.getenv("FINAL_VIDEO_KIE_POLL_INTERVAL_SECONDS", str(DEFAULT_KIE_POLL_INTERVAL_SECONDS))))


def get_heygen_poll_interval_seconds() -> int:
    return max(10, int(os.getenv("FINAL_VIDEO_HEYGEN_POLL_INTERVAL_SECONDS", str(DEFAULT_HEYGEN_POLL_INTERVAL_SECONDS))))


def get_retry_delay_seconds(attempt_count: int) -> int:
    base = max(15, int(os.getenv("FINAL_VIDEO_RETRY_BASE_SECONDS", "30")))
    ceiling = max(base, int(os.getenv("FINAL_VIDEO_RETRY_MAX_SECONDS", "1800")))
    return min(base * max(1, attempt_count), ceiling)


def get_kie_resubmit_attempt_limit() -> int:
    raw_value = (
        os.getenv("FINAL_VIDEO_KIE_RESUBMIT_ATTEMPTS")
        or os.getenv("KIE_RESUBMIT_ATTEMPTS")
        or "3"
    )
    return max(1, int(raw_value))
