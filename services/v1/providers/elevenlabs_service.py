import logging
import os
import re
import uuid

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


def prepare_text_for_elevenlabs_tts(text):
    prepared = text or ""

    def replace_editor_cue(match):
        cue = (match.group(1) or "").lower()
        return EDITOR_CUE_TO_ELEVEN_TAGS.get(cue, "")

    prepared = EDITOR_CUE_RE.sub(replace_editor_cue, prepared)

    for minimax_tag, eleven_tag in MINIMAX_TO_ELEVEN_TAGS.items():
        prepared = re.sub(re.escape(minimax_tag), eleven_tag, prepared, flags=re.IGNORECASE)

    prepared = MINIMAX_TAG_RE.sub("", prepared)
    prepared = re.sub(r"\s+([,.;:!?])", r"\1", prepared)
    prepared = re.sub(r"\s+", " ", prepared).strip()
    return prepared


def text_to_speech_elevenlabs(text, voice_id=DEFAULT_ELEVENLABS_VOICE_ID):
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key or api_key.startswith("your_"):
        raise ValueError("ELEVENLABS_API_KEY is not configured in .env")

    prepared_text = prepare_text_for_elevenlabs_tts(text)
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
