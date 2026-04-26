import argparse
import json
import logging
import os
import re
import subprocess
from typing import Any

from psycopg2.extras import RealDictCursor

from services.v1.database.db_service import get_db_connection, init_db
from services.v1.providers.elevenlabs_service import (
    DEFAULT_ELEVENLABS_VOICE_ID,
    prepare_text_for_elevenlabs_tts,
    text_to_speech_elevenlabs,
)
from services.v1.providers.minimax_service import (
    DEFAULT_MINIMAX_VOICE_ID,
    prepare_text_for_minimax_tts,
    text_to_speech_minimax,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("AvatarVoiceCalibration")


CALIBRATION_SAMPLE_TEXTS = [
    (
        "В поездке всё решают мелочи: чтобы оплата проходила с первого раза, "
        "маршрут не ломался из-за банальных задержек, и можно было спокойно двигаться дальше."
    ),
    (
        "Я заранее проверяю платежный сценарий и оставляю запас по времени, "
        "чтобы в дороге не тратить нервы и не переплачивать за срочные решения."
    ),
]


def _count_spoken_characters(text: str) -> int:
    return len(re.sub(r"\s+", "", text or ""))


def _probe_audio_duration_seconds(file_path: str | None) -> float | None:
    if not file_path or not os.path.exists(file_path):
        return None

    try:
        raw = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                file_path,
            ],
            text=True,
        ).strip()
        duration = float(raw)
        return duration if duration > 0 else None
    except Exception:
        return None


def _parse_avatar_ids(raw_avatar_ids: str | None) -> list[int]:
    if not raw_avatar_ids:
        return []
    result: list[int] = []
    for token in str(raw_avatar_ids).split(","):
        value = token.strip()
        if not value:
            continue
        try:
            parsed = int(value)
        except ValueError:
            continue
        if parsed > 0:
            result.append(parsed)
    return result


def _normalize_provider(raw_provider: Any) -> str:
    return "elevenlabs" if str(raw_provider or "").strip().lower() == "elevenlabs" else "minimax"


def _normalize_pronunciation_overrides(raw_value: Any):
    if isinstance(raw_value, list):
        return raw_value
    if isinstance(raw_value, str):
        try:
            parsed = json.loads(raw_value)
            if isinstance(parsed, list):
                return parsed
        except Exception:
            return []
    return []


def _synthesize_sample_audio(
    provider: str,
    sample_text: str,
    minimax_voice_id: str | None,
    elevenlabs_voice_id: str | None,
    pronunciation_overrides: list[dict],
) -> tuple[str, str]:
    if provider == "elevenlabs":
        prepared_text = prepare_text_for_elevenlabs_tts(
            sample_text,
            pronunciation_overrides=pronunciation_overrides,
        )
        audio_path = text_to_speech_elevenlabs(
            sample_text,
            voice_id=elevenlabs_voice_id or DEFAULT_ELEVENLABS_VOICE_ID,
            pronunciation_overrides=pronunciation_overrides,
        )
        return prepared_text, audio_path

    prepared_text = prepare_text_for_minimax_tts(
        sample_text,
        pronunciation_overrides=pronunciation_overrides,
    )
    audio_path = text_to_speech_minimax(
        sample_text,
        voice_id=minimax_voice_id or DEFAULT_MINIMAX_VOICE_ID,
        pronunciation_overrides=pronunciation_overrides,
    )
    return prepared_text, audio_path


def _calibrate_voice_chars_per_minute(
    provider: str,
    minimax_voice_id: str | None,
    elevenlabs_voice_id: str | None,
    pronunciation_overrides: list[dict],
) -> tuple[float, list[dict]]:
    sample_payloads: list[dict] = []
    total_chars = 0
    total_duration_seconds = 0.0

    for index, sample_text in enumerate(CALIBRATION_SAMPLE_TEXTS, start=1):
        prepared_text = ""
        audio_path = None
        try:
            prepared_text, audio_path = _synthesize_sample_audio(
                provider=provider,
                sample_text=sample_text,
                minimax_voice_id=minimax_voice_id,
                elevenlabs_voice_id=elevenlabs_voice_id,
                pronunciation_overrides=pronunciation_overrides,
            )
            duration_seconds = _probe_audio_duration_seconds(audio_path)
            if not duration_seconds:
                raise RuntimeError("No audio duration returned from ffprobe")

            char_count = _count_spoken_characters(prepared_text)
            if char_count <= 0:
                raise RuntimeError("Prepared calibration text has zero spoken characters")

            chars_per_minute = (char_count * 60.0) / duration_seconds
            sample_payloads.append(
                {
                    "sample_index": index,
                    "chars": char_count,
                    "duration_seconds": round(duration_seconds, 3),
                    "chars_per_minute": round(chars_per_minute, 2),
                }
            )
            total_chars += char_count
            total_duration_seconds += duration_seconds
        finally:
            if audio_path and os.path.exists(audio_path):
                try:
                    os.remove(audio_path)
                except Exception:
                    logger.warning("Failed to cleanup temporary calibration audio: %s", audio_path)

    if total_duration_seconds <= 0 or total_chars <= 0:
        raise RuntimeError("Invalid aggregated calibration data")

    aggregated_chars_per_minute = (total_chars * 60.0) / total_duration_seconds
    return aggregated_chars_per_minute, sample_payloads


def _load_target_avatars(client_id: int, avatar_ids: list[int]) -> list[dict]:
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            if avatar_ids:
                cursor.execute(
                    """
                    SELECT
                        a.id,
                        a.avatar_name,
                        a.tts_provider,
                        a.tts_voice_id,
                        a.elevenlabs_voice_id,
                        c.tts_pronunciation_overrides
                    FROM client_heygen_avatars a
                    LEFT JOIN clients c ON c.id = a.client_id
                    WHERE a.client_id = %s
                      AND a.id = ANY(%s)
                      AND a.is_active = TRUE
                    ORDER BY a.sort_order ASC, a.created_at ASC
                    """,
                    (client_id, avatar_ids),
                )
            else:
                cursor.execute(
                    """
                    SELECT
                        a.id,
                        a.avatar_name,
                        a.tts_provider,
                        a.tts_voice_id,
                        a.elevenlabs_voice_id,
                        c.tts_pronunciation_overrides
                    FROM client_heygen_avatars a
                    LEFT JOIN clients c ON c.id = a.client_id
                    WHERE a.client_id = %s
                      AND a.is_active = TRUE
                    ORDER BY a.sort_order ASC, a.created_at ASC
                    """,
                    (client_id,),
                )
            return [dict(row) for row in (cursor.fetchall() or [])]
    finally:
        conn.close()


def _save_calibration_success(avatar_id: int, chars_per_minute: float, samples: list[dict]) -> None:
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                UPDATE client_heygen_avatars
                SET
                    tts_chars_per_minute = %s,
                    tts_calibrated_at = CURRENT_TIMESTAMP,
                    tts_calibration_error = NULL,
                    tts_calibration_samples_json = %s::jsonb
                WHERE id = %s
                """,
                (round(float(chars_per_minute), 2), json.dumps(samples, ensure_ascii=False), avatar_id),
            )
        conn.commit()
    finally:
        conn.close()


def _save_calibration_failure(avatar_id: int, error_message: str) -> None:
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                UPDATE client_heygen_avatars
                SET
                    tts_calibrated_at = CURRENT_TIMESTAMP,
                    tts_calibration_error = %s
                WHERE id = %s
                """,
                ((error_message or "")[:1000], avatar_id),
            )
        conn.commit()
    finally:
        conn.close()


def run_calibration(client_id: int, avatar_ids: list[int]) -> int:
    target_avatars = _load_target_avatars(client_id=client_id, avatar_ids=avatar_ids)
    if not target_avatars:
        logger.info("No active avatar voices found for calibration (client_id=%s)", client_id)
        return 0

    calibrated_count = 0
    for avatar in target_avatars:
        avatar_id = int(avatar["id"])
        avatar_name = avatar.get("avatar_name") or f"avatar#{avatar_id}"
        provider = _normalize_provider(avatar.get("tts_provider"))
        minimax_voice_id = avatar.get("tts_voice_id")
        elevenlabs_voice_id = avatar.get("elevenlabs_voice_id")
        pronunciation_overrides = _normalize_pronunciation_overrides(avatar.get("tts_pronunciation_overrides"))

        try:
            chars_per_minute, samples = _calibrate_voice_chars_per_minute(
                provider=provider,
                minimax_voice_id=minimax_voice_id,
                elevenlabs_voice_id=elevenlabs_voice_id,
                pronunciation_overrides=pronunciation_overrides,
            )
            _save_calibration_success(
                avatar_id=avatar_id,
                chars_per_minute=chars_per_minute,
                samples=samples,
            )
            calibrated_count += 1
            logger.info(
                "Calibrated avatar voice: id=%s name=%s provider=%s chars_per_minute=%.2f",
                avatar_id,
                avatar_name,
                provider,
                chars_per_minute,
            )
        except Exception as error:
            logger.error(
                "Failed to calibrate avatar voice: id=%s name=%s provider=%s error=%s",
                avatar_id,
                avatar_name,
                provider,
                error,
            )
            _save_calibration_failure(avatar_id=avatar_id, error_message=str(error))

    return calibrated_count


def main():
    parser = argparse.ArgumentParser(description="Calibrate active HeyGen avatar voice speed in chars/min")
    parser.add_argument("--client_id", type=int, required=True, help="Client ID")
    parser.add_argument(
        "--avatar_ids",
        type=str,
        default="",
        help="Optional comma-separated client_heygen_avatars.id list",
    )
    args = parser.parse_args()

    init_db()
    avatar_ids = _parse_avatar_ids(args.avatar_ids)
    calibrated_count = run_calibration(client_id=args.client_id, avatar_ids=avatar_ids)
    logger.info("Calibration completed. Calibrated avatars: %s", calibrated_count)


if __name__ == "__main__":
    main()

