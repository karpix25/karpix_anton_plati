import logging
import os
import re
import uuid
import json

import requests
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv(override=True)

ELEVENLABS_TTS_MODEL = "eleven_v3"
DEFAULT_ELEVENLABS_VOICE_ID = "0ArNnoIAWKlT4WweaVMY"
ELEVENLABS_AUDIO_FORMAT = "mp3_44100_128"
MINIMAX_TAG_RE = re.compile(
    r"\((?:laughs|chuckle|coughs|clear-throat|groans|breath|pant|inhale|exhale|gasps|sniffs|sighs|snorts|burps|lip-smacking|humming|hissing|emm|sneezes)\)",
    re.IGNORECASE,
)
EDITOR_CUE_RE = re.compile(r"\[(surprise|whisper|joy|sad|angry|excited|soft|dramatic)\]", re.IGNORECASE)
MINIMAX_TO_ELEVEN_TAGS = {
    "(laughs)": "[laughs]",
    "(chuckle)": "[laughs]",
    "(coughs)": "[coughs]",
    "(clear-throat)": "[clears throat]",
    "(groans)": "[groans]",
    "(breath)": "[breathes]",
    "(pant)": "[pants]",
    "(inhale)": "[breathes in]",
    "(exhale)": "[breathes out]",
    "(gasps)": "[gasps]",
    "(sniffs)": "[sniffs]",
    "(sighs)": "[sighs]",
    "(snorts)": "[snorts]",
    "(burps)": "[burps]",
    "(lip-smacking)": "[lip smacking]",
    "(humming)": "[hums]",
    "(hissing)": "[hisses]",
    "(emm)": "[hesitates]",
    "(sneezes)": "[sneezes]",
}
EDITOR_CUE_TO_ELEVEN_TAGS = {
    "surprise": "[surprised]",
    "whisper": "[whispers]",
    "joy": "[excited]",
    "sad": "[sad]",
    "angry": "[angry]",
    "excited": "[excited]",
    "soft": "[gentle]",
    "dramatic": "[dramatic]",
}

WORD_BOUNDARY_RE_CLASS = r"A-Za-zА-Яа-яЁё0-9_"


def normalize_elevenlabs_pronunciation_overrides(raw_overrides) -> list[dict]:
    if isinstance(raw_overrides, str):
        try:
            parsed = json.loads(raw_overrides)
            return normalize_elevenlabs_pronunciation_overrides(parsed)
        except Exception:
            return []

    if not isinstance(raw_overrides, list):
        return []

    normalized: list[dict] = []
    for rule in raw_overrides:
        if not isinstance(rule, dict):
            continue
        search = str(rule.get("search") or "").strip()
        replace = str(rule.get("replace") or "").strip()
        if not search or not replace:
            continue
        normalized.append(
            {
                "search": search,
                "replace": replace,
                "case_sensitive": bool(rule.get("case_sensitive")),
                "word_boundaries": bool(rule.get("word_boundaries", True)),
            }
        )
    return normalized


def apply_elevenlabs_replacements(text: str, rules: list[dict]) -> str:
    resolved = text
    for rule in rules:
        search = rule.get("search")
        replace = rule.get("replace")
        if not search or not replace:
            continue

        escaped_search = re.escape(search)
        flags = 0 if rule.get("case_sensitive") else re.IGNORECASE

        if rule.get("word_boundaries"):
            pattern = re.compile(rf"(^|[^{WORD_BOUNDARY_RE_CLASS}])({escaped_search})(?=$|[^{WORD_BOUNDARY_RE_CLASS}])", flags)
            resolved = pattern.sub(lambda match: f"{match.group(1)}{replace}", resolved)
        else:
            pattern = re.compile(escaped_search, flags)
            resolved = pattern.sub(lambda _match: str(replace), resolved)
    return resolved


def prepare_text_for_elevenlabs_tts(text, pronunciation_overrides=None):
    prepared = text or ""

    def replace_editor_cue(match):
        cue = (match.group(1) or "").lower()
        return EDITOR_CUE_TO_ELEVEN_TAGS.get(cue, "")

    prepared = EDITOR_CUE_RE.sub(replace_editor_cue, prepared)

    for minimax_tag, eleven_tag in MINIMAX_TO_ELEVEN_TAGS.items():
        prepared = re.sub(re.escape(minimax_tag), eleven_tag, prepared, flags=re.IGNORECASE)

    prepared = MINIMAX_TAG_RE.sub("", prepared)
    replacement_rules = normalize_elevenlabs_pronunciation_overrides(pronunciation_overrides)
    prepared = apply_elevenlabs_replacements(prepared, replacement_rules)
    prepared = re.sub(r"\s+([,.;:!?])", r"\1", prepared)
    prepared = re.sub(r"\s+", " ", prepared).strip()
    return prepared


def text_to_speech_elevenlabs(text, voice_id=DEFAULT_ELEVENLABS_VOICE_ID, pronunciation_overrides=None):
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key or api_key.startswith("your_"):
        raise ValueError("ELEVENLABS_API_KEY is not configured in .env")

    prepared_text = prepare_text_for_elevenlabs_tts(text, pronunciation_overrides=pronunciation_overrides)
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format={ELEVENLABS_AUDIO_FORMAT}"
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    payload = {
        "text": prepared_text,
        "model_id": ELEVENLABS_TTS_MODEL,
    }

    logger.info("Connecting to ElevenLabs for TTS (Text length: %s characters)", len(prepared_text))
    response = requests.post(url, headers=headers, json=payload, timeout=90)
    if response.status_code != 200:
        logger.error("ElevenLabs API HTTP Error: %s - %s", response.status_code, response.text)
        raise Exception(f"ElevenLabs HTTP error {response.status_code}: {response.text}")

    output_path = f"/tmp/tts_{uuid.uuid4().hex[:8]}.mp3"
    with open(output_path, "wb") as file:
        file.write(response.content)

    logger.info("Successfully generated ElevenLabs TTS to: %s", output_path)
    return output_path
