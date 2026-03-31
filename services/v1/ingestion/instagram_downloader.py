import os
import requests
import logging
import uuid
import json
import socket
from contextlib import contextmanager

from urllib3.util import connection as urllib3_connection

logger = logging.getLogger(__name__)

DEFAULT_RAPIDAPI_INSTAGRAM_HOST = "instagram-social-api.p.rapidapi.com"
DEFAULT_RAPIDAPI_INSTAGRAM_ENDPOINT = "/v1/post_info"


def _get_rapidapi_instagram_config() -> tuple[str, str]:
    host = os.getenv("RAPIDAPI_INSTAGRAM_HOST", DEFAULT_RAPIDAPI_INSTAGRAM_HOST).strip()
    endpoint = os.getenv("RAPIDAPI_INSTAGRAM_ENDPOINT", DEFAULT_RAPIDAPI_INSTAGRAM_ENDPOINT).strip()
    if not endpoint.startswith("/"):
        endpoint = f"/{endpoint}"
    return host, endpoint


def _build_rapidapi_attempts(url: str) -> list[tuple[str, dict[str, str]]]:
    host, configured_endpoint = _get_rapidapi_instagram_config()
    attempts: list[tuple[str, dict[str, str]]] = []

    def add_attempt(endpoint: str, param_key: str) -> None:
        normalized_endpoint = endpoint if endpoint.startswith("/") else f"/{endpoint}"
        candidate = (f"https://{host}{normalized_endpoint}", {param_key: url})
        if candidate not in attempts:
            attempts.append(candidate)

    if "reels" in configured_endpoint:
        add_attempt(configured_endpoint, "username_or_id_or_url")
    else:
        add_attempt(configured_endpoint, "code_or_id_or_url")

    add_attempt("/v1/reels", "username_or_id_or_url")
    add_attempt("/v1/post_info", "code_or_id_or_url")
    return attempts


@contextmanager
def _force_ipv4_resolution():
    original_allowed_gai_family = urllib3_connection.allowed_gai_family
    urllib3_connection.allowed_gai_family = lambda: socket.AF_INET
    try:
        yield
    finally:
        urllib3_connection.allowed_gai_family = original_allowed_gai_family


def _raise_human_readable_download_error(error: Exception, stage: str) -> None:
    message = str(error)
    lowered = message.lower()

    if (
        "nameresolutionerror" in lowered
        or "temporary failure in name resolution" in lowered
        or "failed to resolve" in lowered
    ):
        if stage == "video_binary":
            raise RuntimeError(
                "Не удалось скачать видеофайл Reel с Instagram CDN. "
                "RapidAPI уже отдал ссылку, но сервер не смог зарезолвить или достучаться до "
                "cdninstagram.com. Проверьте исходящий доступ и DNS на сервере."
            ) from error
        raise RuntimeError(
            "Не удалось связаться с Instagram API через RapidAPI. "
            "Похоже, на сервере сейчас проблема с DNS или исходящим доступом. "
            "Попробуйте позже."
        ) from error

    if "network is unreachable" in lowered or "failed to establish a new connection" in lowered:
        if stage == "video_binary":
            raise RuntimeError(
                "RapidAPI вернул ссылку на Reel, но сервер не смог скачать сам mp4 с Instagram CDN. "
                "Чаще всего это проблема исходящего доступа к cdninstagram.com или попытка идти по IPv6 "
                "без рабочего IPv6-маршрута."
            ) from error
        raise RuntimeError(
            "Не удалось установить соединение с Instagram API через RapidAPI. "
            "Проверьте исходящий доступ сервера в интернет."
        ) from error

    if "max retries exceeded" in lowered:
        if stage == "video_binary":
            raise RuntimeError(
                "Не удалось скачать Reel с Instagram CDN после нескольких попыток. "
                "Проверьте доступ сервера к cdninstagram.com."
            ) from error
        raise RuntimeError(
            "Instagram API через RapidAPI не ответил после нескольких попыток. Попробуйте позже."
        ) from error

    if "timeout" in lowered or "timed out" in lowered:
        if stage == "video_binary":
            raise RuntimeError(
                "Скачивание Reel с Instagram CDN не завершилось вовремя. "
                "Проверьте доступ сервера к cdninstagram.com и исходящий трафик."
            ) from error
        raise RuntimeError(
            "Instagram API через RapidAPI не ответил вовремя. Попробуйте повторить позже."
        ) from error

    raise RuntimeError(
        "Не удалось скачать Reel. Попробуйте позже."
    ) from error

def download_instagram_reel(url):
    """
    Downloads a Reel using RapidAPI Social Lens.
    Returns the local path to the video stored in /tmp.
    """
    api_key = os.getenv("RAPIDAPI_KEY")
    if not api_key:
        raise ValueError("RAPIDAPI_KEY not found in environment")

    rapidapi_host, rapidapi_endpoint = _get_rapidapi_instagram_config()

    # Phase 1: Get Video Info
    headers = {
        "x-rapidapi-key": api_key,
        "x-rapidapi-host": rapidapi_host
    }

    logger.info("Fetching Reel info for: %s via RapidAPI host=%s endpoint=%s", url, rapidapi_host, rapidapi_endpoint)
    response = None
    last_error: Exception | None = None

    for api_url, querystring in _build_rapidapi_attempts(url):
        try:
            logger.info("Trying RapidAPI request: %s params=%s", api_url, list(querystring.keys()))
            response = requests.get(api_url, headers=headers, params=querystring, timeout=(20, 60))
            response.raise_for_status()
            break
        except requests.RequestException as error:
            last_error = error
            logger.error("RapidAPI metadata request failed for %s via %s: %s", url, api_url, error)

    if response is None:
        _raise_human_readable_download_error(
            last_error or RuntimeError("Unknown RapidAPI request failure"),
            stage="rapidapi_metadata",
        )

    data = response.json()
    logger.debug(f"API Response: {json.dumps(data)[:500]}...") # Log first 500 chars

    # The API might return data wrapped in 'data' or directly
    payload = data.get("data", data)
    
    # If payload is a list, take first item
    if isinstance(payload, list) and len(payload) > 0:
        item = payload[0]
    # If it has 'items' field (legacy/alternative structure)
    elif isinstance(payload, dict) and payload.get("items"):
        item = payload["items"][0]
    else:
        item = payload

    # Try multiple ways to find the video URL based on common RapidAPI patterns
    video_url = None
    
    # 1. Nested in video_versions (from user screenshot)
    video_versions = item.get("video_versions")
    if video_versions and isinstance(video_versions, list) and len(video_versions) > 0:
        video_url = video_versions[0].get("url")
    
    # 2. Direct keys
    if not video_url:
        video_url = item.get("video_url") or item.get("media_url") or item.get("url")

    if not video_url:
        logger.error(f"Failed to extract video_url. Structure keys: {list(item.keys()) if isinstance(item, dict) else 'Not a dict'}")
        raise ValueError("Could not extract direct video URL from Reels data.")

    # Phase 2: Download the binary
    logger.info(f"Downloading video binary from: {video_url[:50]}...")
    try:
        # Instagram CDN can prefer IPv6 on some hosts; force IPv4 here to avoid
        # "Network is unreachable" on servers without a working IPv6 route.
        with _force_ipv4_resolution():
            video_response = requests.get(video_url, stream=True, timeout=(20, 120))
        video_response.raise_for_status()
    except requests.RequestException as error:
        logger.error("Video binary download failed for %s: %s", video_url, error)
        _raise_human_readable_download_error(error, stage="video_binary")
    
    # Generate unique filename
    file_path = f"/tmp/reel_{uuid.uuid4().hex}.mp4"
    
    with open(file_path, 'wb') as f:
        for chunk in video_response.iter_content(chunk_size=8192):
            f.write(chunk)
            
    logger.info(f"Reel downloaded successfully to: {file_path}")
    return file_path
