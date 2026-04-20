# Copyright (c) 2025 Stephen G. Pope
# Notifier Service for content generation milestones

import os
import logging
import json
import re
import time
from telebot import TeleBot
from services.v1.database.db_service import get_db_connection

logger = logging.getLogger(__name__)

_BOT: TeleBot | None = None
_BOT_TOKEN: str | None = None
_LAST_MISSING_TOKEN_WARNING_TS = 0.0
_LAST_PAYMENT_ALERT_TS: dict[tuple[str, str, str], float] = {}
_MISSING_TOKEN_WARNING_COOLDOWN_SECONDS = 300
_PAYMENT_ALERT_COOLDOWN_SECONDS = 900


def _resolve_bot_token() -> str | None:
    for env_key in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_TOKEN", "BOT_TOKEN"):
        value = str(os.getenv(env_key) or "").strip()
        if value:
            return value
    return None


def _get_bot() -> TeleBot | None:
    global _BOT, _BOT_TOKEN, _LAST_MISSING_TOKEN_WARNING_TS

    token = _resolve_bot_token()
    if not token:
        now_ts = time.time()
        if now_ts - _LAST_MISSING_TOKEN_WARNING_TS >= _MISSING_TOKEN_WARNING_COOLDOWN_SECONDS:
            logger.warning("Telegram token missing. Set TELEGRAM_BOT_TOKEN (or TELEGRAM_TOKEN).")
            _LAST_MISSING_TOKEN_WARNING_TS = now_ts
        _BOT = None
        _BOT_TOKEN = None
        return None

    if _BOT is None or _BOT_TOKEN != token:
        try:
            _BOT = TeleBot(token)
            _BOT_TOKEN = token
        except Exception as error:
            logger.error("Failed to initialize Telegram bot client: %s", error)
            _BOT = None
            _BOT_TOKEN = None
            return None

    return _BOT

PAYMENT_ERROR_PATTERNS = [
    re.compile(r"payment_required", re.IGNORECASE),
    re.compile(r"paid_plan_required", re.IGNORECASE),
    re.compile(r"insufficient\s+(funds|balance|credits?)", re.IGNORECASE),
    re.compile(r"credits?\s+insufficient", re.IGNORECASE),
    re.compile(r"not\s+enough\s+(credit|balance|credits?)", re.IGNORECASE),
    re.compile(r"quota\s+exceeded", re.IGNORECASE),
    re.compile(r"out\s+of\s+credits?", re.IGNORECASE),
    re.compile(r"credits?\s+exhausted", re.IGNORECASE),
    re.compile(r"subscription|plan\s+required|upgrade", re.IGNORECASE),
    re.compile(r"authorization\s+failed", re.IGNORECASE),
    re.compile(r"unauthorized", re.IGNORECASE),
    re.compile(r"\\b401\\b", re.IGNORECASE),
    re.compile(r"\\b402\\b", re.IGNORECASE),
]

def send_admin_notification(message_text):
    """Sends a plain text message directly to the administrative chat."""
    bot = _get_bot()
    if not bot:
        return False

    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not chat_id:
        logger.warning("TELEGRAM_CHAT_ID missing. Cannot send admin notification.")
        return False

    try:
        bot.send_message(chat_id=chat_id, text=message_text, parse_mode=None)
        return True
    except Exception as e:
        logger.error(f"Failed to send admin notification: {e}")
        return False

def send_telegram_notification(client_id, message_text, parse_mode="Markdown", fallback_to_main_chat=True):
    """Sends a message to all Telegram topics associated with a client."""
    bot = _get_bot()
    if not bot:
        return False
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT topic_id FROM topic_configs WHERE client_id = %s", (client_id,))
        topics = cursor.fetchall()
        cursor.close()
        conn.close()

        chat_id = os.getenv("TELEGRAM_CHAT_ID")
        if not chat_id:
            logger.warning("TELEGRAM_CHAT_ID missing. Cannot send notification.")
            return False

        if not topics:
            if not fallback_to_main_chat:
                return False
            bot.send_message(chat_id=chat_id, text=message_text, parse_mode=parse_mode)
            return True

        success = False
        for (topic_id,) in topics:
            try:
                bot.send_message(
                    chat_id=chat_id,
                    text=message_text,
                    message_thread_id=int(topic_id) if topic_id and topic_id != "0" else None,
                    parse_mode=parse_mode,
                )
                success = True
            except Exception as e:
                logger.error(f"Failed to send to topic {topic_id}: {e}")
        return success
    except Exception as e:
        logger.error(f"Notification error: {e}")
        return False

def send_to_super_admins(message_text, parse_mode="Markdown"):
    """Broadcast a message to all super admin chat IDs defined in TELEGRAM_SUPER_ADMIN_IDS."""
    bot = _get_bot()
    if not bot:
        return False
    raw_ids = os.getenv("TELEGRAM_SUPER_ADMIN_IDS", "").strip()
    if not raw_ids:
        logger.warning("TELEGRAM_SUPER_ADMIN_IDS missing. No super admin broadcast.")
        return False
    ids = [tid.strip() for tid in raw_ids.split(",") if tid.strip().isdigit()]
    if not ids:
        logger.warning("No valid super admin IDs found in TELEGRAM_SUPER_ADMIN_IDS.")
        return False
    success = False
    for admin_id in ids:
        try:
            bot.send_message(chat_id=admin_id, text=message_text, parse_mode=parse_mode)
            success = True
        except Exception as e:
            logger.error(f"Failed to send super admin notification to {admin_id}: {e}")
    return success

def _stringify_error(error: object) -> str:
    if isinstance(error, str):
        return error
    if isinstance(error, dict):
        try:
            return json.dumps(error, ensure_ascii=False)
        except Exception:
            return str(error)
    return str(error)

def _is_payment_issue(message: str) -> bool:
    if not message:
        return False
    return any(pattern.search(message) for pattern in PAYMENT_ERROR_PATTERNS)

def notify_service_payment_issue(client_id: int | None, provider: str, error: object) -> bool:
    message = _stringify_error(error)
    if not _is_payment_issue(message):
        return False

    normalized_provider = (provider or "unknown").strip().lower()
    normalized_client = str(client_id or "global")
    normalized_message = (message or "").strip().lower()
    alert_key = (normalized_client, normalized_provider, normalized_message[:200])
    now_ts = time.time()
    last_ts = _LAST_PAYMENT_ALERT_TS.get(alert_key)
    if last_ts and (now_ts - last_ts) < _PAYMENT_ALERT_COOLDOWN_SECONDS:
        return False

    short_message = message.strip()
    if len(short_message) > 420:
        short_message = f"{short_message[:420]}..."

    text = (
        f"🚨 [SERVICE ERROR] {provider}\n"
        f"Похоже, закончился баланс или достигнут лимит.\n"
        f"Детали: {short_message}"
    )

    # Always notify admins
    sent_admin = send_admin_notification(text)
    # Broadcast to super admins
    sent_super_admins = send_to_super_admins(text, parse_mode=None)
    # If client context exists, also notify client topics
    sent_client_topics = False
    if client_id:
        sent_client_topics = send_telegram_notification(client_id, text, parse_mode=None, fallback_to_main_chat=False)

    sent = sent_admin or sent_super_admins or sent_client_topics
    _LAST_PAYMENT_ALERT_TS[alert_key] = now_ts
    return sent
