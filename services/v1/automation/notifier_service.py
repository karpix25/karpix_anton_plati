# Copyright (c) 2025 Stephen G. Pope
# Notifier Service for content generation milestones

import os
import logging
import json
import re
from telebot import TeleBot
from services.v1.database.db_service import get_db_connection

logger = logging.getLogger(__name__)

token = os.getenv("TELEGRAM_BOT_TOKEN")
bot = TeleBot(token) if token else None

PAYMENT_ERROR_PATTERNS = [
    re.compile(r"payment_required", re.IGNORECASE),
    re.compile(r"paid_plan_required", re.IGNORECASE),
    re.compile(r"insufficient\s+(funds|balance|credits?)", re.IGNORECASE),
    re.compile(r"not\s+enough\s+(credit|balance|credits?)", re.IGNORECASE),
    re.compile(r"quota\s+exceeded", re.IGNORECASE),
    re.compile(r"out\s+of\s+credits?", re.IGNORECASE),
    re.compile(r"credits?\s+exhausted", re.IGNORECASE),
    re.compile(r"subscription|plan\s+required|upgrade", re.IGNORECASE),
    re.compile(r"\b402\b", re.IGNORECASE),
]

def send_telegram_notification(client_id, message_text, parse_mode="Markdown"):
    """
    Sends a message to all Telegram topics associated with a client.
    """
    if not bot:
        logger.warning("Telegram token missing. Cannot send notification.")
        return False


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
    if not client_id:
        return False

    message = _stringify_error(error)
    if not _is_payment_issue(message):
        return False

    short_message = message.strip()
    if len(short_message) > 420:
        short_message = f"{short_message[:420]}..."

    text = (
        f"[{provider}] Похоже, закончился баланс или подписка.\n"
        f"Детали: {short_message}"
    )
    return send_telegram_notification(client_id, text, parse_mode=None)
        
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Find all topics for this client
        cursor.execute("SELECT topic_id FROM topic_configs WHERE client_id = %s", (client_id,))
        topics = cursor.fetchall()
        cursor.close()
        conn.close()
        
        if not topics:
            logger.info(f"No Telegram topics found for Client {client_id}")
            return False
            
        success = False
        for (topic_id,) in topics:
            try:
                # topic_id in Telebot can be handled as the message_thread_id 
                # if the bot is in a forum group. 
                # Usually we use chat_id (e.g. from environment or config).
                # For this setup, we assume topic_id is the thread_id.
                chat_id = os.getenv("TELEGRAM_CHAT_ID") # Primary group chat ID
                
                if chat_id:
                    bot.send_message(
                        chat_id=chat_id,
                        text=message_text,
                        message_thread_id=int(topic_id) if topic_id != "0" else None,
                        parse_mode=parse_mode
                    )
                    success = True
            except Exception as e:
                logger.error(f"Failed to send to topic {topic_id}: {e}")
                
        return success
    except Exception as e:
        logger.error(f"Notification error: {e}")
        return False
