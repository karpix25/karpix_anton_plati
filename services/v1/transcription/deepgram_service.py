import os
import logging
import re
import socket
from deepgram import DeepgramClient

logger = logging.getLogger(__name__)
TOKEN_RE = re.compile(r"\S+")


def _round(value, digits=2):
    try:
        return round(float(value), digits)
    except (TypeError, ValueError):
        return 0.0


def _build_transcript_meta(transcript, words):
    safe_words = [w for w in (words or []) if isinstance(w, dict)]
    word_count = len([w for w in safe_words if w.get("word")])

    start_candidates = [w.get("start") for w in safe_words if isinstance(w.get("start"), (int, float))]
    end_candidates = [w.get("end") for w in safe_words if isinstance(w.get("end"), (int, float))]

    start_time = min(start_candidates) if start_candidates else 0.0
    end_time = max(end_candidates) if end_candidates else 0.0
    duration_seconds = max(end_time - start_time, 0.0)
    words_per_minute = (word_count / duration_seconds * 60.0) if duration_seconds > 0 else 0.0

    return {
        "word_count": word_count or len((transcript or "").split()),
        "duration_seconds": _round(duration_seconds),
        "duration_ms": int(duration_seconds * 1000) if duration_seconds > 0 else 0,
        "words_per_minute": _round(words_per_minute),
        "start_time": _round(start_time),
        "end_time": _round(end_time),
    }


def build_fallback_transcript_alignment(text):
    transcript = " ".join((text or "").split())
    if not transcript:
        return {
            "transcript": "",
            "words": [],
            "transcript_meta": _build_transcript_meta("", []),
            "is_fallback": True,
        }

    words = []
    cursor = 0.0
    for token in TOKEN_RE.findall(transcript):
        clean_word = re.sub(r"^[^\wА-Яа-яЁё]+|[^\wА-Яа-яЁё]+$", "", token) or token
        base_duration = max(0.16, min(0.48, 0.12 + (len(clean_word) * 0.018)))
        pause_duration = 0.0
        if token.endswith((".", "!", "?")):
            pause_duration = 0.18
        elif token.endswith((",", ";", ":")):
            pause_duration = 0.08

        start = round(cursor, 2)
        end = round(cursor + base_duration, 2)
        words.append({
            "word": clean_word,
            "punctuated_word": token,
            "start": start,
            "end": end,
            "confidence": None,
        })
        cursor = end + pause_duration

    return {
        "transcript": transcript,
        "words": words,
        "transcript_meta": _build_transcript_meta(transcript, words),
        "is_fallback": True,
    }

def transcribe_media_deepgram(file_path):
    """
    Transcribes media using Deepgram SDK.
    Uses a robust implementation compatible with multiple SDK versions.
    """
    api_key = os.getenv("DEEPGRAM_API_KEY")
    if not api_key:
        raise ValueError("DEEPGRAM_API_KEY not found in environment")

    # In SDK v6+, DeepgramClient requires keyword arguments
    # and has a different internal structure.
    try:
        deepgram = DeepgramClient(api_key=api_key)
        
        logger.info(f"Opening file for transcription: {file_path}")
        
        with open(file_path, "rb") as file:
            buffer_data = file.read()

        # Using a dictionary for options is more robust across SDK versions
        options = {
            "model": "nova-2",
            "smart_format": True,
            "diarize": True,
            "language": "ru",
        }

        logger.info(f"Sending request to Deepgram...")
        
        # Using the correct SDK v3 interface (keyword-only arguments)
        logger.info(f"Sending request to Deepgram v1 media API...")
        
        response = deepgram.listen.v1.media.transcribe_file(
            request=buffer_data,
            **options
        )
        
        # Extract transcript and words using Pydantic model attributes
        # response is a ListenV1Response object
        results = response.results
        channels = results.channels
        alternatives = channels[0].alternatives
        
        transcript = alternatives[0].transcript
        words = alternatives[0].words
        
        logger.info("Transcription completed successfully.")
        
        # Convert words to dict list if they are objects
        word_list = []
        for w in words:
            if hasattr(w, "to_dict"):
                word_list.append(w.to_dict())
            elif isinstance(w, dict):
                word_list.append(w)
            else:
                # Handle pydantic/other models
                word_list.append(dict(w))

        return {
            "transcript": transcript,
            "words": word_list,
            "transcript_meta": _build_transcript_meta(transcript, word_list),
        }
    except Exception as e:
        message = str(e).lower()
        if isinstance(e, socket.gaierror) or "name or service not known" in message or "failed to resolve" in message:
            logger.error("Deepgram transcription failed due to DNS resolution error: %s", e)
            raise RuntimeError(
                "Не удалось связаться с Deepgram. Похоже, сервер не может зарезолвить api.deepgram.com. "
                "Проверьте DNS и исходящий доступ сервера."
            ) from e
        if "network is unreachable" in message or "failed to establish a new connection" in message:
            logger.error("Deepgram transcription failed due to outbound network error: %s", e)
            raise RuntimeError(
                "Не удалось подключиться к Deepgram. Проверьте исходящий доступ сервера в интернет."
            ) from e
        if "timeout" in message or "timed out" in message:
            logger.error("Deepgram transcription timed out: %s", e)
            raise RuntimeError(
                "Deepgram не ответил вовремя. Попробуйте позже."
            ) from e

        logger.error(f"Deepgram transcription failed: {e}")
        raise
