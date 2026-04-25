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


def prepare_text_for_minimax_tts(text):
    return text or ""


def text_to_speech_minimax(text, voice_id=DEFAULT_MINIMAX_VOICE_ID, speed=1.1):
    """
    Generates high-quality TTS using MiniMax T2A V2 API.
    Returns path to local audio file.
    """
    voice_id = voice_id or DEFAULT_MINIMAX_VOICE_ID
    api_key = os.getenv("MINIMAX_API_KEY")
    group_id = os.getenv("MINIMAX_GROUP_ID")
    
    if not api_key or not group_id or api_key.startswith("your_"):
        logger.error("MINIMAX_API_KEY or MINIMAX_GROUP_ID missing or not configured")
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
