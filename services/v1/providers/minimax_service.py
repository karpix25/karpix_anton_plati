import os
import requests
import json
import logging
import uuid
import re
from dotenv import load_dotenv

# Set up logging
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv(override=True)

PRONUNCIATION_RULES = [
    {"source": "Airbnb", "target": "Эйрбиэнби", "aliases": ["airbnb"]},
    {"source": "Booking", "target": "Букинг", "aliases": ["booking.com", "Booking.com", "booking"]},
    {"source": "7-Eleven", "target": "севен илевен", "aliases": ["7-11", "7 eleven", "seven eleven", "Seven Eleven", "семь-одиннадцать", "семь одиннадцать"]},
    {"source": "Instagram", "target": "Инстаграм", "aliases": ["instagram"]},
    {"source": "WhatsApp", "target": "Вотсап", "aliases": ["Whatsapp", "whatsapp"]},
    {"source": "Telegram", "target": "Телеграм", "aliases": ["telegram"]},
    {"source": "PayPal", "target": "Пэйпэл", "aliases": ["Paypal", "paypal"]},
    {"source": "Wise", "target": "Вайз", "aliases": ["wise"]},
    {"source": "Payoneer", "target": "Пайонир", "aliases": ["payoneer"]},
    {"source": "Revolut", "target": "Револют", "aliases": ["revolut"]},
    {"source": "Binance", "target": "Байнэнс", "aliases": ["binance"]},
    {"source": "Mastercard", "target": "Мастеркард", "aliases": ["mastercard", "MasterCard"]},
]


def _escape_regexp(value):
    return re.escape(value)


def _build_pronunciation_tone(text):
    entries = []
    seen = set()

    for rule in PRONUNCIATION_RULES:
        variants = [rule["source"], *(rule.get("aliases") or [])]
        for variant in variants:
            regex = re.compile(rf"(^|[^A-Za-zА-Яа-яЁё])({_escape_regexp(variant)})(?=$|[^A-Za-zА-Яа-яЁё])", re.IGNORECASE)
            match = regex.search(text or "")
            if not match:
                continue

            source = match.group(2)
            entry = f"{source}/{rule['target']}"
            if entry not in seen:
                entries.append(entry)
                seen.add(entry)

    return entries

DEFAULT_MINIMAX_VOICE_ID = "Russian_Engaging_Podcaster_v1"
MINIMAX_TTS_MODEL = "speech-2.8-hd"
SUPPORTED_INTERJECTION_RE = re.compile(
    r"\((?:laughs|chuckle|coughs|clear-throat|groans|breath|pant|inhale|exhale|gasps|sniffs|sighs|snorts|burps|lip-smacking|humming|hissing|emm|sneezes)\)",
    re.IGNORECASE,
)


def _attach_interjection_after_first(text, pattern, interjection):
    return pattern.sub(lambda match: f"{match.group(1)}{interjection}{match.group(2) or ''}", text, count=1)


def _attach_interjection_to_sentence_lead(sentence, interjection):
    return re.sub(r"^([^\s,.;:!?()]+)", rf"\1{interjection}", sentence, count=1)


def _inject_interjections(text):
    editor_cue_map = {
        "surprise": "(gasps)",
        "whisper": "(breath)",
        "joy": "(chuckle)",
        "sad": "(sighs)",
        "angry": "(snorts)",
        "excited": "(inhale)",
        "soft": "(breath)",
        "dramatic": "(inhale)",
    }

    def replace_editor_cue(match):
        cue = (match.group(1) or "").lower()
        return editor_cue_map.get(cue, "")

    enriched = re.sub(r"\s*\[(surprise|whisper|joy|sad|angry|excited|soft|dramatic)\]", replace_editor_cue, text or "", flags=re.IGNORECASE)

    if not SUPPORTED_INTERJECTION_RE.search(enriched):
        direct_rules = [
            (re.compile(r"(\b(?:ха-?ха|хаха|усмехнувшись|усмехается|смешно)\b)([,.;:!?]?)", re.IGNORECASE), "(chuckle)"),
            (re.compile(r"(\b(?:эх|увы|к сожалению)\b)([,.;:!?]?)", re.IGNORECASE), "(sighs)"),
            (re.compile(r"(\b(?:ничего себе|вот это да|неужели|серьёзно|серьезно)\b)([,.;:!?]?)", re.IGNORECASE), "(gasps)"),
        ]

        for pattern, interjection in direct_rules:
            if pattern.search(enriched):
                enriched = _attach_interjection_after_first(enriched, pattern, interjection)
                break

        sentences = re.findall(r"[^.!?]+[.!?]?", enriched) or [enriched]
        injected_count = enriched.count("(")
        rebuilt_sentences = []

        for raw_sentence in sentences:
            sentence = raw_sentence.strip()
            if not sentence or SUPPORTED_INTERJECTION_RE.search(sentence) or injected_count >= 3:
                rebuilt_sentences.append(raw_sentence)
                continue

            lower = sentence.lower()
            interjection = None

            if re.search(r"\b(?:давайте|смотрите|представьте|теперь)\b", sentence, re.IGNORECASE):
                interjection = "(inhale)"
            elif re.search(r"\b(?:кстати|ну|знаете)\b", sentence, re.IGNORECASE):
                interjection = "(emm)"
            elif re.search(r"\b(?:ошибка|разочар|депрессив|проблем|санкц|налог|риск|тяжело|сложно)\b", sentence, re.IGNORECASE):
                interjection = "(sighs)"
            elif len(sentence) > 90 or re.search(r"\b(?:автоматически|финансов|независим|благополуч)\b", lower, re.IGNORECASE):
                interjection = "(breath)"

            if not interjection:
                rebuilt_sentences.append(raw_sentence)
                continue

            injected_count += 1
            punctuation_match = re.search(r"[.!?]\s*$", raw_sentence)
            punctuation = punctuation_match.group(0).strip() if punctuation_match else ""
            body = sentence[:-len(punctuation)] if punctuation else sentence
            rebuilt_sentences.append(_attach_interjection_to_sentence_lead(body, interjection) + punctuation)

        enriched = " ".join(part.strip() for part in rebuilt_sentences if part.strip())

    return (
        re.sub(r"\s+\(", "(", enriched)
        .replace(") ,", "),")
        .replace(") .", ").")
        .replace(") !", ")!")
        .replace(") ?", ")?")
        .strip()
    )


def prepare_text_for_minimax_tts(text):
    return _inject_interjections(text or "")


def text_to_speech_minimax(text, voice_id=DEFAULT_MINIMAX_VOICE_ID, speed=1.1, emotion=None):
    """
    Generates high-quality TTS using MiniMax T2A V2 API.
    Returns path to local audio file.
    """
    voice_id = voice_id or DEFAULT_MINIMAX_VOICE_ID
    api_key = os.getenv("MINIMAX_API_KEY")
    group_id = os.getenv("MINIMAX_GROUP_ID")
    
    if not api_key or not group_id or api_key.startswith("your_"):
        logger.error("MINIMAX_API_KEY or MINIMAX_GROUP_ID missing or not configured")
        # For now, return a mock path to avoid crashing the pipeline if we just want a placeholder
        # return "/tmp/tts_output.mp3"
        raise ValueError("MiniMax API keys are not configured in .env")

    # MiniMax T2A V2 URL
    url = "https://api.minimax.io/v1/t2a_v2"
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    prepared_text = prepare_text_for_minimax_tts(text)

    payload = {
        "model": MINIMAX_TTS_MODEL,
        "text": prepared_text,
        "stream": False,
        "voice_setting": {
            "voice_id": voice_id,
            "speed": speed,
            "vol": 1.0,
            "pitch": 0
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": "mp3"
        }
    }

    pronunciation_tone = _build_pronunciation_tone(prepared_text)
    if pronunciation_tone:
        payload["pronunciation_dict"] = {
            "tone": pronunciation_tone
        }
    
    if emotion:
        payload["voice_setting"]["emotion"] = emotion
    
    try:
        logger.info(f"Connecting to MiniMax for TTS (Text length: {len(text)} characters)")
        response = requests.post(url, headers=headers, json=payload, timeout=45)
        
        if response.status_code != 200:
            logger.error(f"MiniMax API HTTP Error: {response.status_code} - {response.text}")
            raise Exception(f"MiniMax HTTP error {response.status_code}")
            
        result = response.json()
        
        if "base_resp" in result and result["base_resp"]["status_code"] != 0:
            error_code = result["base_resp"]["status_code"]
            error_msg = result["base_resp"]["status_msg"]
            logger.error(f"MiniMax API Error Code {error_code}: {error_msg}")
            
            # Common errors
            if error_code == 1004:
                raise Exception("MiniMax Authorization failed. Please check your API key.")
            elif error_code == 1001:
                raise Exception("MiniMax Group ID is incorrect.")
            elif error_code == 2013:
                raise Exception(f"MiniMax Voice ID '{voice_id}' not found.")
            else:
                raise Exception(f"MiniMax Error: {error_msg}")
                
        if "data" in result and "audio" in result["data"]:
            audio_hex = result["data"]["audio"]
            audio_data = bytes.fromhex(audio_hex)
            
            output_path = f"/tmp/tts_{uuid.uuid4().hex[:8]}.mp3"
            with open(output_path, "wb") as f:
                f.write(audio_data)
                
            logger.info(f"Successfully generated TTS to: {output_path}")
            return output_path
        else:
            logger.error(f"Incomplete response from MiniMax: {result}")
            raise Exception("MiniMax failed to return audio data.")
            
    except Exception as e:
        logger.error(f"Critical error in MiniMax TTS: {e}")
        # Return fallback to not break everything if it's a transient failure? 
        # No, better raise so the pipeline knows.
        raise
