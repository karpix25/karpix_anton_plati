# Copyright (c) 2025 Stephen G. Pope
# Notifier Service for content generation milestones

import os
import logging
from telebot import TeleBot
from services.v1.database.db_service import get_db_connection

logger = logging.getLogger(__name__)

token = os.getenv("TELEGRAM_BOT_TOKEN")
bot = TeleBot(token) if token else None

def send_telegram_notification(client_id, message_text, parse_mode="Markdown"):
    """
    Sends a message to all Telegram topics associated with a client.
    """
    if not bot:
        logger.warning("Telegram token missing. Cannot send notification.")
        return False
        
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
