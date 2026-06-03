import os
import logging
import re
import socket
from typing import Any, List
from deepgram import DeepgramClient

logger = logging.getLogger(__name__)
TOKEN_RE = re.compile(r"\S+")
DEFAULT_DEEPGRAM_KEYWORD_BOOST = 5
MAX_DEEPGRAM_KEYWORDS = 100


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

def _split_deepgram_terms(value: Any) -> List[str]:
    if not isinstance(value, str) or not value.strip():
        return []
    return [item.strip().strip("\"'") for item in re.split(r"[,;\n]", value) if item.strip()]

def _normalize_deepgram_vocabulary_rules(value: Any, legacy_keywords: Any = None) -> List[dict]:
    rules = []
    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict):
                continue
            display = str(item.get("display") or "").strip()
            variants = str(item.get("variants") or "").strip()
            if display:
                rules.append({"display": display, "variants": variants})
    if rules:
        return rules

    legacy_terms = _split_deepgram_terms(legacy_keywords)
    if len(legacy_terms) > 1:
        return [{"display": legacy_terms[0], "variants": ", ".join(legacy_terms[1:])}]
    return []

def _build_deepgram_keyword_source(keywords: Any = None, vocabulary_rules: Any = None) -> str:
    rules = _normalize_deepgram_vocabulary_rules(vocabulary_rules, keywords)
    terms = []
    for rule in rules:
        terms.append(rule["display"])
        terms.extend(_split_deepgram_terms(rule.get("variants")))
    if terms:
        return ", ".join(terms)
    return str(keywords or "").strip()

def _parse_deepgram_keywords(value: Any) -> List[str]:
    terms = _split_deepgram_terms(value)
    if not terms:
        return []

    keywords = []
    for keyword in terms:
        match = re.match(r"^(.+):(-?\d+(?:\.\d+)?)$", keyword)
        if match:
            term = match.group(1).strip()
            try:
                boost = min(10, max(1, float(match.group(2))))
            except ValueError:
                boost = DEFAULT_DEEPGRAM_KEYWORD_BOOST
            keywords.append(f"{term}:{boost:g}")
        else:
            keywords.append(f"{keyword}:{DEFAULT_DEEPGRAM_KEYWORD_BOOST}")

        if len(keywords) >= MAX_DEEPGRAM_KEYWORDS:
            break

    return keywords

def _normalize_comparable(value: Any) -> str:
    return re.sub(r"[^\wА-Яа-яЁё]+", "", str(value or "").lower(), flags=re.UNICODE)

def _trailing_punctuation(value: Any) -> str:
    match = re.search(r"[^\wА-Яа-яЁё]+$", str(value or ""), flags=re.UNICODE)
    return match.group(0) if match else ""

def _apply_transcript_replacements(transcript: str, replacements: List[dict]) -> str:
    text = transcript or ""
    for replacement in replacements:
        pattern = re.compile(re.escape(replacement["term"]), flags=re.IGNORECASE)
        text = pattern.sub(replacement["display"], text)
    return text

def _find_word_replacement(words: List[dict], index: int, replacements: List[dict]):
    candidates = sorted(replacements, key=lambda item: len(item["tokens"]), reverse=True)
    for replacement in candidates:
        tokens = replacement["tokens"]
        if len(tokens) > len(words) - index:
            continue
        if all(
            _normalize_comparable(words[index + offset].get("punctuated_word") or words[index + offset].get("word"))
            == _normalize_comparable(token)
            for offset, token in enumerate(tokens)
        ):
            return replacement
    return None

def _apply_word_replacements(words: List[dict], replacements: List[dict]) -> List[dict]:
    result = []
    index = 0
    while index < len(words):
        replacement = _find_word_replacement(words, index, replacements)
        if not replacement:
            result.append(words[index])
            index += 1
            continue

        matched = words[index:index + len(replacement["tokens"])]
        first = dict(matched[0])
        last = matched[-1]
        first["word"] = replacement["display"]
        first["punctuated_word"] = f"{replacement['display']}{_trailing_punctuation(last.get('punctuated_word') or last.get('word'))}"
        first["end"] = last.get("end", first.get("end"))
        confidences = [item.get("confidence") for item in matched if isinstance(item.get("confidence"), (int, float))]
        first["confidence"] = min(confidences) if confidences else None
        result.append(first)
        index += len(replacement["tokens"])
    return result

def _apply_deepgram_vocabulary(transcript: str, words: List[dict], vocabulary_rules: Any, legacy_keywords: Any = None):
    rules = _normalize_deepgram_vocabulary_rules(vocabulary_rules, legacy_keywords)
    if not rules:
        return transcript, words

    replacements = []
    for rule in rules:
        display = rule["display"]
        for term in [display, *_split_deepgram_terms(rule.get("variants"))]:
            tokens = [token for token in str(term).split() if token]
            if tokens:
                replacements.append({"display": display, "term": term, "tokens": tokens})

    return _apply_transcript_replacements(transcript, replacements), _apply_word_replacements(words, replacements)

def transcribe_media_deepgram(file_path, keywords=None, vocabulary_rules=None):
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
        keyword_params = _parse_deepgram_keywords(_build_deepgram_keyword_source(keywords, vocabulary_rules))
        if keyword_params:
            options["keywords"] = keyword_params

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

        transcript, word_list = _apply_deepgram_vocabulary(transcript, word_list, vocabulary_rules, keywords)

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
