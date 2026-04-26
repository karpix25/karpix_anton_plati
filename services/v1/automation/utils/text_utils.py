import re
import logging

logger = logging.getLogger(__name__)

def count_spoken_characters(text: str | None) -> int:
    return len(re.sub(r"\s+", "", text or ""))

def split_sentences(text: str):
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if not cleaned:
        return []
    parts = re.split(r"(?<=[.!?])\s+", cleaned)
    return [part.strip() for part in parts if part.strip()]

def normalize_text_for_comparison(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip()).lower().replace("ё", "е")

def normalize_narrator_gender(gender, default="female") -> str:
    raw = str(gender or "").strip().lower().replace("ё", "е")
    if not raw:
        return default

    male_aliases = {"male", "man", "m", "м", "муж", "мужской"}
    female_aliases = {"female", "woman", "f", "ж", "жен", "женский"}

    if raw in male_aliases or raw.startswith("male") or raw.startswith("муж"):
        return "male"
    if raw in female_aliases or raw.startswith("female") or raw.startswith("жен"):
        return "female"

    logger.warning("Unknown narrator gender '%s', fallback to '%s'", gender, default)
    return default
