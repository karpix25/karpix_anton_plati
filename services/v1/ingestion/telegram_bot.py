import os
import sys
import logging
import re

# Add project root to sys.path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../"))
if project_root not in sys.path:
    sys.path.append(project_root)

from telebot import TeleBot
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from services.v1.automation.pipeline_orchestrator import run_content_gen_pipeline
from services.v1.database.db_service import (
    save_topic_config, 
    get_topic_config, 
    create_client, 
    get_client,
    get_db_connection
)

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

token = os.getenv("TELEGRAM_BOT_TOKEN")
if not token:
    logger.error("TELEGRAM_BOT_TOKEN not found in environment")
    exit(1)

bot = TeleBot(token)

def _plain(text):
    return str(text or "").replace("`", "").replace("*", "")


def _detect_topic_name(message):
    if message.reply_to_message and getattr(message.reply_to_message, "forum_topic_created", None):
        return message.reply_to_message.forum_topic_created.name
    return "General"


def build_connection_help_message(message, config=None):
    topic_id = str(message.message_thread_id or "0")
    topic_name = _plain(_detect_topic_name(message))
    client_name = _plain((config or {}).get("client_name"))

    lines = [
        "Как подключить проект к Telegram-боту",
        "",
        "1. Создайте проект командой /new_client НазваниеПроекта",
        "2. Перейдите в нужный топик и привяжите проект: /assign_client НазваниеПроекта",
        "3. При необходимости задайте контекст:",
        "/set_client_product ...",
        "/set_brand ...",
        "4. После этого просто отправляйте Instagram Reel ссылку в этот топик",
        "",
        f"Текущий topic_id: {topic_id}",
        f"Текущая ниша / имя топика: {topic_name}",
    ]

    if config:
        lines.extend(
            [
                f"Сейчас подключен клиент: {client_name}",
                f"Ниша по конфигу: {_plain(config.get('niche'))}",
            ]
        )
    else:
        lines.extend(
            [
                "Сейчас этот топик не привязан ни к одному проекту.",
                "Быстрый пример:",
                "/new_client Plati",
                "/assign_client Plati",
            ]
        )

    return "\n".join(lines)


def build_commands_help_message(message, config=None):
    connection_help = build_connection_help_message(message, config=config)
    return (
        f"{connection_help}\n\n"
        "Основные команды\n"
        "/client_info показать текущий проект в топике\n"
        "/connect_help показать инструкцию по подключению\n"
        "/whereami показать topic_id и статус привязки\n"
    )

def extract_reel_link(text):
    """Simple regex to find Instagram Reel links."""
    pattern = r'(https?://(?:www\.)?instagram\.com/reels?/[\w-]+)'
    match = re.search(pattern, text)
    return match.group(0) if match else None


@bot.message_handler(commands=['start', 'help'])
def handle_start(message):
    topic_id = str(message.message_thread_id or "0")
    config = get_topic_config(topic_id)
    bot.reply_to(message, build_commands_help_message(message, config=config))


@bot.message_handler(commands=['connect_help'])
def handle_connect_help(message):
    topic_id = str(message.message_thread_id or "0")
    config = get_topic_config(topic_id)
    bot.reply_to(message, build_connection_help_message(message, config=config))


@bot.message_handler(commands=['whereami'])
def handle_whereami(message):
    topic_id = str(message.message_thread_id or "0")
    config = get_topic_config(topic_id)
    if config:
        bot.reply_to(
            message,
            (
                f"chat_id: {message.chat.id}\n"
                f"topic_id: {topic_id}\n"
                f"Клиент: {_plain(config['client_name'])}\n"
                f"Ниша: {_plain(config['niche'])}"
            ),
        )
        return

    bot.reply_to(
        message,
        (
            f"chat_id: {message.chat.id}\n"
            f"topic_id: {topic_id}\n"
            "Этот топик пока не привязан к проекту.\n\n"
            f"{build_connection_help_message(message)}"
        ),
    )

@bot.message_handler(commands=['new_client'])
def handle_new_client(message):
    name = message.text.replace('/new_client', '').strip()
    if not name:
        bot.reply_to(message, "Укажите имя клиента. Пример: /new_client Nike")
        return
    
    client_id = create_client(name)
    if client_id:
        bot.reply_to(
            message,
            (
                f"Клиент {_plain(name)} создан (ID: {client_id}).\n"
                f"Теперь привяжите его в этом топике командой:\n/assign_client {name}"
            ),
        )
    else:
        bot.reply_to(message, "❌ Ошибка создания клиента. Возможно, имя уже занято.")

@bot.message_handler(commands=['assign_client'])
def handle_assign_client(message):
    topic_id = str(message.message_thread_id or "0")
    name = message.text.replace('/assign_client', '').strip()
    if not name:
        bot.reply_to(
            message,
            "Укажите имя клиента. Пример: /assign_client Nike\n\nЕсли проект ещё не создан, сначала выполните /new_client Nike.",
        )
        return
    
    client = get_client(name=name)
    if not client:
        bot.reply_to(
            message,
            (
                f"Клиент {_plain(name)} не найден.\n"
                f"Создайте его через /new_client {name} и затем повторите /assign_client {name}."
            ),
        )
        return
    
    # Check if a niche can be extracted from topic name
    niche = "General"
    if message.reply_to_message and message.reply_to_message.forum_topic_created:
        niche = message.reply_to_message.forum_topic_created.name

    save_topic_config(topic_id, client["id"], niche)
    bot.reply_to(
        message,
        (
            f"Этот топик теперь привязан к клиенту {_plain(name)}.\n"
            f"Ниша по умолчанию: {_plain(niche)}.\n\n"
            "Теперь можно:\n"
            "- отправлять Reel-ссылки для разбора\n"
            "- смотреть `/client_info`\n"
            "- настроить `/set_client_product` и `/set_brand`"
        ),
    )

@bot.message_handler(commands=['client_info'])
def handle_client_info(message):
    topic_id = str(message.message_thread_id or "0")
    config = get_topic_config(topic_id)
    if not config:
        bot.reply_to(message, build_connection_help_message(message), parse_mode="Markdown")
        return
    
    info = (
        f"Клиент: {_plain(config['client_name'])}\n"
        f"Ниша: {_plain(config['niche'])}\n"
        f"Продукт: {_plain(config.get('product_info') or 'Не задан')}\n"
        f"Voice: {_plain(config.get('brand_voice') or 'Стандартный')}\n"
        f"Audience: {_plain(config.get('target_audience') or 'Не задана')}"
    )
    bot.reply_to(message, info)

@bot.message_handler(commands=['set_brand'])
def handle_set_brand(message):
    topic_id = str(message.message_thread_id or "0")
    config = get_topic_config(topic_id)
    if not config:
        bot.reply_to(message, "Сначала привяжите клиента через /assign_client.")
        return
    
    brand_voice = message.text.replace('/set_brand', '').strip()
    if not brand_voice:
        bot.reply_to(message, "Опишите Brand Voice. Пример: /set_brand Дерзкий, молодежный, много сленга")
        return
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE clients SET brand_voice = %s WHERE id = %s", (brand_voice, config["client_id"]))
        conn.commit()
        cursor.close()
        conn.close()
        bot.reply_to(message, "✅ Brand Voice успешно обновлен!")
    except Exception as e:
        bot.reply_to(message, f"❌ Ошибка обновления: {e}")

@bot.message_handler(commands=['set_client_product'])
def handle_set_client_product(message):
    topic_id = str(message.message_thread_id or "0")
    config = get_topic_config(topic_id)
    if not config:
        bot.reply_to(message, "Сначала привяжите клиента через /assign_client.")
        return
    
    product = message.text.replace('/set_client_product', '').strip()
    if not product:
        bot.reply_to(message, "Опишите продукт. Пример: /set_client_product Новая коллекция кроссовок")
        return
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE clients SET product_info = %s WHERE id = %s", (product, config["client_id"]))
        conn.commit()
        cursor.close()
        conn.close()
        bot.reply_to(message, "✅ Описание продукта обновлено!")
    except Exception as e:
        bot.reply_to(message, f"❌ Ошибка обновления: {e}")

@bot.message_handler(func=lambda message: True)
def handle_message(message):
    if not message.text:
        return

    topic_id = str(message.message_thread_id or "0")
    config = get_topic_config(topic_id)
    
    reel_url = extract_reel_link(message.text)
    
    if reel_url:
        if not config:
            bot.reply_to(
                message,
                "🛑 Этот топик не привязан к проекту.\n\n"
                + build_connection_help_message(message),
            )
            return

        logger.info(f"[{message.chat.id}] Client: {config['client_name']} | Reel: {reel_url}")
        
        status_msg = f"Разбираю референс для {_plain(config['client_name'])}\nНиша: {_plain(config['niche'])}"
        bot.reply_to(message, status_msg + "\n\nЗапускаю атомарную деконструкцию...")
        
        try:
            job_id = f"tg_{message.chat.id}_{message.message_id}"
            
            # Pass full client context to pipeline
            result = run_content_gen_pipeline(
                job_id=job_id,
                reels_url=reel_url,
                niche=config["niche"],
                target_product_info=config.get("product_info"),
                client_id=config["client_id"], # New field
                analysis_only=True,
                generate_video=False
            )
            
            if result["status"] == "analysis_complete":
                audit = result["audit"]
                atoms = audit.get("atoms", {})
                
                response = (
                    f"Анализ для {_plain(config['client_name'])} готов!\n\n"
                    f"Хук: {_plain(atoms.get('verbal_hook'))}\n"
                    f"Триггер: {_plain(atoms.get('psychological_trigger'))}\n\n"
                    f"Скелет:\n{chr(10).join([f'- {_plain(b)}' for b in atoms.get('narrative_skeleton', [])])}\n\n"
                    f"DNA: {_plain(audit.get('viral_dna_synthesis'))}\n"
                    f"Score: {_plain(audit.get('viral_score'))}/100"
                )
                bot.reply_to(message, response)

            elif result["status"] == "scenario_complete":
                audit = result.get("audit", {})
                scenario = result.get("scenario", {})
                atoms = audit.get("atoms", {})
                hunt = (audit.get("hunt_ladder") or {}).get("stage", "Не определена")

                response = (
                    f"Разбор и сценарий для {_plain(config['client_name'])} готовы!\n\n"
                    f"Хук: {_plain(atoms.get('verbal_hook'))}\n"
                    f"Триггер: {_plain(atoms.get('psychological_trigger'))}\n"
                    f"Стадия Ханта: {_plain(hunt)}\n\n"
                    f"Сценарий:\n{_plain(scenario.get('script', 'Сценарий не найден'))}"
                )
                bot.reply_to(message, response)

            elif result["status"] == "quota_exceeded":
                bot.reply_to(
                    message,
                    f"Лимит генераций достигнут.\n\n{_plain(result.get('message', 'Месячный лимит исчерпан.'))}",
                )
            
        except Exception as e:
            logger.error(f"Error: {e}")
            bot.reply_to(message, f"❌ Ошибка: {str(e)}")
        return

    lowered_text = message.text.lower()
    if any(trigger in lowered_text for trigger in ["подключ", "как подключ", "help", "/help", "старт", "start"]):
        bot.reply_to(message, build_commands_help_message(message, config=config))

if __name__ == "__main__":
    logger.info("Starting Multi-Client Bot...")
    bot.infinity_polling()
