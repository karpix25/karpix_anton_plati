import logging
import os
import time
from typing import Any, Dict, Optional

import requests
from dotenv import load_dotenv

load_dotenv(override=True)

logger = logging.getLogger(__name__)

HEYGEN_API_BASE = "https://api.heygen.com"
HEYGEN_UPLOAD_BASE = "https://upload.heygen.com"
DEFAULT_DIMENSION = {"width": 1080, "height": 1920}
PENDING_STATUSES = {"pending", "waiting", "processing"}
SUCCESS_STATUSES = {"completed", "success"}
PHOTO_AVATAR_MOTION_PROMPT = """
The subject is framed in a natural vertical talking-head shot with a calm, professional, and approachable presence. They maintain steady eye contact with the lens and a soft conversational expression.

The body should feel naturally alive rather than static: subtle breathing, small shoulder adjustments, gentle torso sway, light weight shifts, tiny posture corrections, and restrained hand or arm micro-movements if the hands are visible. Head movement should stay soft and organic, with small natural turns and micro-reactions, never exaggerated.

Avoid broad gestures, repetitive nodding, theatrical emphasis, sudden movements, or anything that feels robotic or over-animated. The performance should look like a real person being filmed, not a frozen photo and not a high-energy presenter.

If the original image includes visible background elements, allow slight natural environmental motion that stays secondary to the speaker, such as faint movement in hair, clothing, foliage, curtains, reflections, or light changes. Background motion should remain subtle, believable, and calm.

Overall direction: natural presenter energy, realistic body life, gentle ambient scene movement, polished but human.
""".strip()


def _get_api_key() -> str:
    api_key = os.getenv("HEYGEN_API_KEY")
    if not api_key or api_key.startswith("your_"):
        raise ValueError("HEYGEN_API_KEY is not configured in .env")
    return api_key


def _extract_error(payload: Optional[Dict[str, Any]]) -> str:
    payload = payload or {}
    error = payload.get("error")
    if isinstance(error, dict):
        return error.get("message") or error.get("code") or str(error)
    if error:
        return str(error)
    return payload.get("message") or "Unknown HeyGen API error"


def _heygen_request(method: str, url: str, **kwargs: Any) -> Dict[str, Any]:
    headers = kwargs.pop("headers", {})
    headers["X-Api-Key"] = _get_api_key()

    response = requests.request(method, url, headers=headers, timeout=kwargs.pop("timeout", 60), **kwargs)

    try:
        payload = response.json()
    except ValueError:
        payload = {"message": response.text}

    if not response.ok:
        raise RuntimeError(_extract_error(payload))

    return payload


def upload_audio_asset(audio_source: str) -> str:
    """
    Uploads a local audio file to HeyGen and returns the asset ID.
    """
    local_path = audio_source.replace("file://", "", 1) if audio_source.startswith("file://") else audio_source
    if not os.path.exists(local_path):
        raise FileNotFoundError(f"Audio file not found: {local_path}")

    with open(local_path, "rb") as audio_file:
        audio_bytes = audio_file.read()

    payload = _heygen_request(
        "POST",
        f"{HEYGEN_UPLOAD_BASE}/v1/asset",
        data=audio_bytes,
        headers={
            "Content-Type": "audio/mpeg",
            "Content-Length": str(len(audio_bytes)),
        },
    )

    asset_id = (payload.get("data") or {}).get("id")
    if not asset_id:
        raise RuntimeError("HeyGen upload response did not include an asset ID")
    return str(asset_id)


def _build_voice_payload(audio_source: str) -> Dict[str, Any]:
    if audio_source.startswith("http://") or audio_source.startswith("https://"):
        return {"type": "audio", "audio_url": audio_source}

    return {"type": "audio", "audio_asset_id": upload_audio_asset(audio_source)}


def _build_character_payload(avatar_id: str, look_id: Optional[str] = None) -> Dict[str, Any]:
    if look_id:
        return {
            "type": "talking_photo",
            "talking_photo_id": look_id,
            "scale": 1.0,
            "talking_photo_style": "square",
        }

    return {
        "type": "avatar",
        "avatar_id": avatar_id,
        "avatar_style": "normal",
        "scale": 1.0,
    }


def _resolve_usable_look_id(look_id: Optional[str]) -> Optional[str]:
    if not look_id:
        return None

    try:
        payload = _heygen_request("GET", f"{HEYGEN_API_BASE}/v2/photo_avatar/{look_id}")
        details = (payload.get("data") or {}) if isinstance(payload, dict) else {}
        status = str(details.get("status") or "").lower()
        is_motion = details.get("is_motion") is True
        if is_motion and status != "completed":
            logger.info("HeyGen motion look %s exists but is still %s", look_id, status or "pending")
            return None
        return look_id
    except Exception as error:
        logger.warning("HeyGen motion/photo look %s is not ready, falling back if possible: %s", look_id, error)
        return None


def generate_avatar_video(
    audio_url: str,
    avatar_id: str,
    look_id: Optional[str] = None,
    fallback_look_id: Optional[str] = None,
) -> str:
    """
    Triggers HeyGen to generate an avatar video from an uploaded or remote audio source.
    """
    candidate_motion_look_id = look_id if look_id and look_id != fallback_look_id else None
    resolved_look_id = _resolve_usable_look_id(candidate_motion_look_id) or fallback_look_id
    logger.info("Triggering HeyGen video generation with avatar_id=%s look_id=%s fallback_look_id=%s resolved_look_id=%s", avatar_id, look_id, fallback_look_id, resolved_look_id)

    payload = {
        "video_inputs": [
            {
                "character": _build_character_payload(avatar_id, look_id=resolved_look_id),
                "voice": _build_voice_payload(audio_url),
                "background": {"type": "color", "value": "#F8FAFC"},
                **({"expressiveness": "medium"} if resolved_look_id else {}),
                **({"motion_prompt": PHOTO_AVATAR_MOTION_PROMPT} if resolved_look_id else {}),
            }
        ],
        "dimension": DEFAULT_DIMENSION,
        "caption": False,
    }

    response_payload = _heygen_request("POST", f"{HEYGEN_API_BASE}/v2/video/generate", json=payload)
    video_id = (response_payload.get("data") or {}).get("video_id")
    if not video_id:
        raise RuntimeError("HeyGen create video response did not include video_id")

    return str(video_id)


def get_video_status(job_id: str) -> Dict[str, Any]:
    """
    Retrieves current HeyGen video status/details.
    """
    return _heygen_request("GET", f"{HEYGEN_API_BASE}/v1/video_status.get?video_id={job_id}")


def wait_for_heygen_video(job_id: str, poll_interval_seconds: int = 5, timeout_seconds: int = 600) -> str:
    """
    Polls HeyGen until the final video URL is available.
    """
    logger.info("Waiting for HeyGen job=%s", job_id)
    started_at = time.time()

    while True:
        payload = get_video_status(job_id)
        data = payload.get("data") or {}
        status = str(data.get("status") or "").lower()
        video_url = data.get("video_url")

        if video_url and status in SUCCESS_STATUSES:
            return str(video_url)

        if status == "failed":
            raise RuntimeError(_extract_error(payload))

        if status not in PENDING_STATUSES and not video_url:
            raise RuntimeError(f"Unexpected HeyGen status: {status or 'unknown'}")

        if time.time() - started_at > timeout_seconds:
            raise TimeoutError(f"Timed out waiting for HeyGen video {job_id}")

        time.sleep(poll_interval_seconds)
