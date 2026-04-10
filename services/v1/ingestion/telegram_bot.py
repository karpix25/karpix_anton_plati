import os
import sys
import logging
import re
from typing import Any, Dict, Optional, Set

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
    init_db,
    save_topic_config, 
    get_topic_config, 
    create_client, 
    get_client,
    get_db_connection,
    get_telegram_user_access,
    request_telegram_access,
    ensure_telegram_admin,
    approve_telegram_user,
    reject_telegram_user,
    list_pending_telegram_users,
    list_telegram_users,
    is_telegram_admin,
    attach_telegram_user_to_web_auth_request,
    approve_telegram_web_auth_request,
)

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

token = os.getenv("TELEGRAM_BOT_TOKEN")
if not token:
    logger.error("TELEGRAM_BOT_TOKEN not found in environment")
    exit(1)

bot = TeleBot(token)

def _parse_admin_ids_from_env() -> Set[int]:
    raw_tokens = []
    raw_ids = str(os.getenv("TELEGRAM_ADMIN_IDS", "")).strip()
    if raw_ids:
        raw_tokens.extend(re.split(r"[,\s;]+", raw_ids))
    legacy_id = str(os.getenv("TELEGRAM_ADMIN_ID", "")).strip()
    if legacy_id:
        raw_tokens.append(legacy_id)

    admin_ids: Set[int] = set()
    invalid_tokens = []
    for token in raw_tokens:
        value = str(token or "").strip()
        if not value:
            continue
        try:
            admin_ids.add(int(value))
        except ValueError:
            invalid_tokens.append(value)

    if invalid_tokens:
        logger.warning(
            "Some TELEGRAM_ADMIN_IDS values are invalid and ignored: %s",
            ", ".join(invalid_tokens),
        )
    return admin_ids

ADMIN_TELEGRAM_IDS = _parse_admin_ids_from_env()

WEBAPP_BASE_URL = str(
    os.getenv("WEBAPP_BASE_URL")
    or os.getenv("UI_BASE_URL")
    or ""
).strip().rstrip("/")

def _plain(text):
    return str(text or "").replace("`", "").replace("*", "")


def _reply_in_same_thread(message, text: str):
    kwargs = {
        "chat_id": message.chat.id,
        "text": text,
        "reply_to_message_id": message.message_id,
    }
    if getattr(message, "message_thread_id", None):
        kwargs["message_thread_id"] = message.message_thread_id
    try:
        return bot.send_message(**kwargs)
    except Exception as error:
        logger.error(
            "Failed to send Telegram reply to chat_id=%s thread_id=%s message_id=%s: %s",
            message.chat.id,
            getattr(message, "message_thread_id", None),
            message.message_id,
            error,
        )
        return None


def _detect_topic_name(message):
    if message.reply_to_message and getattr(message.reply_to_message, "forum_topic_created", None):
        return message.reply_to_message.forum_topic_created.name
    return "General"

def _extract_command_arg(text: Optional[str], command: str) -> str:
    if not text:
        return ""
    pattern = rf"^/{command}(?:@\w+)?(?:\s+(.*))?$"
    match = re.match(pattern, text.strip(), flags=re.IGNORECASE)
    if not match:
        return ""
    return (match.group(1) or "").strip()

def _format_user_label(row: Optional[Dict[str, Any]]) -> str:
    if not row:
        return "Unknown user"
    first_name = _plain(row.get("first_name"))
    last_name = _plain(row.get("last_name"))
    username = _plain(row.get("username"))
    display_name = " ".join(part for part in [first_name, last_name] if part).strip()
    if display_name and username:
        return f"{display_name} (@{username})"
    if display_name:
        return display_name
    if username:
        return f"@{username}"
    return f"id={row.get('telegram_user_id')}"

def _is_admin_user(telegram_user_id: Optional[int]) -> bool:
    if telegram_user_id is None:
        return False
    if int(telegram_user_id) in ADMIN_TELEGRAM_IDS:
        return True
    try:
        return is_telegram_admin(int(telegram_user_id))
    except Exception as error:
        logger.error("Failed to check Telegram admin status for %s: %s", telegram_user_id, error)
        return False

def _ensure_admin_record_for_user(user) -> None:
    user_id = getattr(user, "id", None)
    if not user_id or int(user_id) not in ADMIN_TELEGRAM_IDS:
        return
    try:
        ensure_telegram_admin(
            telegram_user_id=int(user_id),
            username=getattr(user, "username", None),
            first_name=getattr(user, "first_name", None),
            last_name=getattr(user, "last_name", None),
        )
    except Exception as error:
        logger.error("Failed to upsert main Telegram admin record: %s", error)

def _build_pending_access_message(user_id: int) -> str:
    if ADMIN_TELEGRAM_IDS:
        return (
            "Заявка на доступ принята и отправлена администраторам.\n"
            "После одобрения вы сможете пользоваться ботом.\n\n"
            f"Ваш Telegram ID: {user_id}"
        )
    return (
        "Заявка на доступ создана, но админы не настроены.\n"
        "Добавьте TELEGRAM_ADMIN_IDS (или TELEGRAM_ADMIN_ID) в .env и перезапустите бота.\n\n"
        f"Ваш Telegram ID: {user_id}"
    )

def _notify_main_admin_about_request(access_row: Dict[str, Any]) -> None:
    if not ADMIN_TELEGRAM_IDS:
        return
    requester_id = int(access_row.get("telegram_user_id"))
    text = (
        "Новая заявка на доступ к боту\n\n"
        f"Пользователь: {_format_user_label(access_row)}\n"
        f"Telegram ID: {requester_id}\n"
        f"Статус: {_plain(access_row.get('status'))}\n\n"
        f"Команды:\n/approve_user {requester_id}\n/reject_user {requester_id}"
    )
    for admin_id in sorted(ADMIN_TELEGRAM_IDS):
        if requester_id == int(admin_id):
            continue
        try:
            bot.send_message(chat_id=admin_id, text=text)
        except Exception as error:
            logger.error("Failed to notify admin %s about access request: %s", admin_id, error)

def _parse_web_auth_payload(payload: str) -> Optional[tuple[str, str]]:
    text = str(payload or "").strip()
    if not text.startswith("wa_"):
        return None
    parts = text.split("_")
    if len(parts) != 3:
        return None
    request_id = parts[1].strip()
    nonce = parts[2].strip()
    if not request_id or not nonce:
        return None
    return request_id, nonce

def _handle_web_auth_start(message, payload: str, access_row: Optional[Dict[str, Any]]) -> bool:
    parsed = _parse_web_auth_payload(payload)
    if not parsed:
        return False

    user = getattr(message, "from_user", None)
    if not user or not getattr(user, "id", None):
        _reply_in_same_thread(message, "Не удалось определить пользователя Telegram.")
        return True

    request_id, nonce = parsed
    telegram_user_id = int(user.id)

    approved = _is_admin_user(telegram_user_id) or str((access_row or {}).get("status") or "").lower() == "approved"
    if approved:
        if not WEBAPP_BASE_URL:
            _reply_in_same_thread(
                message,
                "Не настроен WEBAPP_BASE_URL. Сообщите администратору сервиса.",
            )
            return True

        auth_result = approve_telegram_web_auth_request(
            request_id=request_id,
            nonce=nonce,
            telegram_user_id=telegram_user_id,
            username=getattr(user, "username", None),
            first_name=getattr(user, "first_name", None),
            last_name=getattr(user, "last_name", None),
        )
        if not auth_result:
            _reply_in_same_thread(
                message,
                "Ссылка авторизации истекла или уже использована. Вернитесь в интерфейс и нажмите кнопку входа снова.",
            )
            return True

        callback_url = (
            f"{WEBAPP_BASE_URL}/api/auth/telegram/callback"
            f"?requestId={auth_result['request_id']}&token={auth_result['session_token']}"
        )
        _reply_in_same_thread(
            message,
            (
                "Авторизация подтверждена.\n"
                f"Откройте ссылку, чтобы вернуться в браузер:\n{callback_url}"
            ),
        )
        return True

    attach_telegram_user_to_web_auth_request(
        request_id=request_id,
        nonce=nonce,
        telegram_user_id=telegram_user_id,
    )
    _reply_in_same_thread(message, _build_pending_access_message(telegram_user_id))
    return True

def _authorize_message(message, require_admin: bool = False) -> Optional[Dict[str, Any]]:
    user = getattr(message, "from_user", None)
    if not user or not getattr(user, "id", None):
        _reply_in_same_thread(message, "Не удалось определить пользователя Telegram.")
        return None

    _ensure_admin_record_for_user(user)
    telegram_user_id = int(user.id)
    access = get_telegram_user_access(telegram_user_id)
    if require_admin:
        if _is_admin_user(telegram_user_id):
            return access or {}
        _reply_in_same_thread(message, "Эта команда доступна только администратору.")
        return None

    if not access:
        _reply_in_same_thread(
            message,
            "У вас нет доступа к боту. Отправьте /start, чтобы создать заявку на одобрение.",
        )
        return None

    status = str(access.get("status") or "").lower()
    if status == "approved":
        return access
    if status == "pending":
        _reply_in_same_thread(
            message,
            "Доступ ещё не одобрен. Ожидайте подтверждение от администратора.",
        )
        return None

    _reply_in_same_thread(
        message,
        "Ваша заявка отклонена. Отправьте /start, чтобы подать запрос повторно.",
    )
    return None


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


def build_commands_help_message(message, config=None, is_admin=False):
    connection_help = build_connection_help_message(message, config=config)
    base = (
        f"{connection_help}\n\n"
        "Основные команды\n"
        "/client_info показать текущий проект в топике\n"
        "/connect_help показать инструкцию по подключению\n"
        "/whereami показать topic_id и статус привязки\n"
    )
    if not is_admin:
        return base
    return (
        f"{base}\n"
        "Админ-команды\n"
        "/pending_users показать заявки на доступ\n"
        "/approve_user <telegram_id> одобрить пользователя\n"
        "/reject_user <telegram_id> отклонить пользователя\n"
        "/list_users [status] список пользователей доступа\n"
    )

def extract_reel_link(text):
    """Simple regex to find Instagram Reel links."""
    pattern = r'(https?://(?:www\.)?instagram\.com/reels?/[\w-]+)'
    match = re.search(pattern, text)
    return match.group(0) if match else None


@bot.message_handler(commands=['start', 'help'])
def handle_start(message):
    user = getattr(message, "from_user", None)
    if not user or not getattr(user, "id", None):
        _reply_in_same_thread(message, "Не удалось определить пользователя Telegram.")
        return

    _ensure_admin_record_for_user(user)
    topic_id = str(message.message_thread_id or "0")
    config = get_topic_config(topic_id)
    telegram_user_id = int(user.id)
    start_payload = _extract_command_arg(message.text, "start")

    if _is_admin_user(telegram_user_id):
        admin_access = ensure_telegram_admin(
            telegram_user_id=telegram_user_id,
            username=getattr(user, "username", None),
            first_name=getattr(user, "first_name", None),
            last_name=getattr(user, "last_name", None),
        )
        if start_payload and _handle_web_auth_start(message, start_payload, admin_access):
            return
        _reply_in_same_thread(message, build_commands_help_message(message, config=config, is_admin=True))
        return

    previous_access = get_telegram_user_access(telegram_user_id)
    access_row = request_telegram_access(
        telegram_user_id=telegram_user_id,
        username=getattr(user, "username", None),
        first_name=getattr(user, "first_name", None),
        last_name=getattr(user, "last_name", None),
    )
    previous_status = str((previous_access or {}).get("status") or "").lower()
    current_status = str((access_row or {}).get("status") or "").lower()
    if current_status == "pending" and previous_status != "pending":
        _notify_main_admin_about_request(access_row)

    if start_payload and _handle_web_auth_start(message, start_payload, access_row):
        return

    if current_status == "approved":
        _reply_in_same_thread(message, build_commands_help_message(message, config=config, is_admin=False))
    else:
        _reply_in_same_thread(message, _build_pending_access_message(telegram_user_id))


@bot.message_handler(commands=['pending_users'])
def handle_pending_users(message):
    if not _authorize_message(message, require_admin=True):
        return

    pending = list_pending_telegram_users(limit=30)
    if not pending:
        _reply_in_same_thread(message, "Сейчас нет заявок в статусе pending.")
        return

    lines = ["Ожидающие заявки:"]
    for row in pending:
        user_id = row.get("telegram_user_id")
        requested_at = row.get("requested_at")
        lines.append(f"- {user_id}: {_format_user_label(row)} | requested_at={requested_at}")
    _reply_in_same_thread(message, "\n".join(lines))


@bot.message_handler(commands=['approve_user'])
def handle_approve_user(message):
    if not _authorize_message(message, require_admin=True):
        return

    user_id_raw = _extract_command_arg(message.text, "approve_user")
    if not user_id_raw:
        _reply_in_same_thread(message, "Укажите telegram_id. Пример: /approve_user 123456789")
        return

    try:
        user_id = int(user_id_raw)
    except ValueError:
        _reply_in_same_thread(message, "telegram_id должен быть числом.")
        return

    if _is_admin_user(user_id):
        _reply_in_same_thread(message, "Этот пользователь уже является администратором.")
        return

    admin_user_id = int(getattr(message.from_user, "id"))
    updated = approve_telegram_user(user_id, admin_user_id)
    _reply_in_same_thread(
        message,
        f"Пользователь {user_id} одобрен.\nСтатус: {_plain(updated.get('status'))}",
    )
    try:
        bot.send_message(chat_id=user_id, text="Ваша заявка одобрена. Доступ к боту открыт.")
    except Exception as error:
        logger.warning("Failed to notify approved user %s: %s", user_id, error)


@bot.message_handler(commands=['reject_user'])
def handle_reject_user(message):
    if not _authorize_message(message, require_admin=True):
        return

    user_id_raw = _extract_command_arg(message.text, "reject_user")
    if not user_id_raw:
        _reply_in_same_thread(message, "Укажите telegram_id. Пример: /reject_user 123456789")
        return

    try:
        user_id = int(user_id_raw)
    except ValueError:
        _reply_in_same_thread(message, "telegram_id должен быть числом.")
        return

    if _is_admin_user(user_id):
        _reply_in_same_thread(message, "Нельзя отклонить главного администратора.")
        return

    admin_user_id = int(getattr(message.from_user, "id"))
    updated = reject_telegram_user(user_id, admin_user_id)
    _reply_in_same_thread(
        message,
        f"Пользователь {user_id} отклонён.\nСтатус: {_plain(updated.get('status'))}",
    )
    try:
        bot.send_message(chat_id=user_id, text="Ваша заявка отклонена. Можно отправить /start для повторной заявки.")
    except Exception as error:
        logger.warning("Failed to notify rejected user %s: %s", user_id, error)


@bot.message_handler(commands=['list_users'])
def handle_list_users(message):
    if not _authorize_message(message, require_admin=True):
        return

    status = _extract_command_arg(message.text, "list_users").lower()
    status_filter = status if status in {"pending", "approved", "rejected"} else None
    rows = list_telegram_users(limit=50, status=status_filter)

    if not rows:
        _reply_in_same_thread(message, "Список пользователей пуст.")
        return

    lines = [f"Пользователи доступа ({status_filter or 'all'}):"]
    for row in rows:
        lines.append(
            f"- {row.get('telegram_user_id')}: {_format_user_label(row)} | "
            f"status={_plain(row.get('status'))} | admin={bool(row.get('is_admin'))}"
        )
    _reply_in_same_thread(message, "\n".join(lines))


@bot.message_handler(commands=['connect_help'])
def handle_connect_help(message):
    if not _authorize_message(message):
        return
    topic_id = str(message.message_thread_id or "0")
    config = get_topic_config(topic_id)
    _reply_in_same_thread(message, build_connection_help_message(message, config=config))


@bot.message_handler(commands=['whereami'])
def handle_whereami(message):
    if not _authorize_message(message):
        return
    topic_id = str(message.message_thread_id or "0")
    config = get_topic_config(topic_id)
    if config:
        _reply_in_same_thread(
            message,
            (
                f"chat_id: {message.chat.id}\n"
                f"topic_id: {topic_id}\n"
                f"Клиент: {_plain(config['client_name'])}\n"
                f"Ниша: {_plain(config['niche'])}"
            ),
        )
        return

    _reply_in_same_thread(
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
    if not _authorize_message(message):
        return

    name = _extract_command_arg(message.text, 'new_client')
    if not name:
        _reply_in_same_thread(message, "Укажите имя клиента. Пример: /new_client Nike")
        return
    
    client_id = create_client(name)
    if client_id:
        _reply_in_same_thread(
            message,
            (
                f"Клиент {_plain(name)} создан (ID: {client_id}).\n"
                f"Теперь привяжите его в этом топике командой:\n/assign_client {name}"
            ),
        )
    else:
        _reply_in_same_thread(message, "❌ Ошибка создания клиента. Возможно, имя уже занято.")

@bot.message_handler(commands=['assign_client'])
def handle_assign_client(message):
    if not _authorize_message(message):
        return

    topic_id = str(message.message_thread_id or "0")
    name = _extract_command_arg(message.text, 'assign_client')
    if not name:
        _reply_in_same_thread(
            message,
            "Укажите имя клиента. Пример: /assign_client Nike\n\nЕсли проект ещё не создан, сначала выполните /new_client Nike.",
        )
        return
    
    client = get_client(name=name)
    if not client:
        _reply_in_same_thread(
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
    _reply_in_same_thread(
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
    if not _authorize_message(message):
        return

    topic_id = str(message.message_thread_id or "0")
    config = get_topic_config(topic_id)
    if not config:
        _reply_in_same_thread(message, build_connection_help_message(message))
        return
    
    info = (
        f"Клиент: {_plain(config['client_name'])}\n"
        f"Ниша: {_plain(config['niche'])}\n"
        f"Продукт: {_plain(config.get('product_info') or 'Не задан')}\n"
        f"Voice: {_plain(config.get('brand_voice') or 'Стандартный')}\n"
        f"Audience: {_plain(config.get('target_audience') or 'Не задана')}"
    )
    _reply_in_same_thread(message, info)

@bot.message_handler(commands=['set_brand'])
def handle_set_brand(message):
    if not _authorize_message(message):
        return

    topic_id = str(message.message_thread_id or "0")
    config = get_topic_config(topic_id)
    if not config:
        _reply_in_same_thread(message, "Сначала привяжите клиента через /assign_client.")
        return
    
    brand_voice = _extract_command_arg(message.text, 'set_brand')
    if not brand_voice:
        _reply_in_same_thread(message, "Опишите Brand Voice. Пример: /set_brand Дерзкий, молодежный, много сленга")
        return
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE clients SET brand_voice = %s WHERE id = %s", (brand_voice, config["client_id"]))
        conn.commit()
        cursor.close()
        conn.close()
        _reply_in_same_thread(message, "✅ Brand Voice успешно обновлен!")
    except Exception as e:
        _reply_in_same_thread(message, f"❌ Ошибка обновления: {e}")

@bot.message_handler(commands=['set_client_product'])
def handle_set_client_product(message):
    if not _authorize_message(message):
        return

    topic_id = str(message.message_thread_id or "0")
    config = get_topic_config(topic_id)
    if not config:
        _reply_in_same_thread(message, "Сначала привяжите клиента через /assign_client.")
        return
    
    product = _extract_command_arg(message.text, 'set_client_product')
    if not product:
        _reply_in_same_thread(message, "Опишите продукт. Пример: /set_client_product Новая коллекция кроссовок")
        return
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE clients SET product_info = %s WHERE id = %s", (product, config["client_id"]))
        conn.commit()
        cursor.close()
        conn.close()
        _reply_in_same_thread(message, "✅ Описание продукта обновлено!")
    except Exception as e:
        _reply_in_same_thread(message, f"❌ Ошибка обновления: {e}")

@bot.message_handler(func=lambda message: True)
def handle_message(message):
    if not message.text:
        return

    access = _authorize_message(message)
    if not access:
        return

    topic_id = str(message.message_thread_id or "0")
    config = get_topic_config(topic_id)
    
    reel_url = extract_reel_link(message.text)
    
    if reel_url:
        if not config:
            _reply_in_same_thread(
                message,
                "🛑 Этот топик не привязан к проекту.\n\n"
                + build_connection_help_message(message),
            )
            return

        logger.info(f"[{message.chat.id}] Client: {config['client_name']} | Reel: {reel_url}")
        
        status_msg = f"Разбираю референс для {_plain(config['client_name'])}\nНиша: {_plain(config['niche'])}"
        _reply_in_same_thread(message, status_msg + "\n\nЗапускаю атомарную деконструкцию...")
        
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
                _reply_in_same_thread(message, response)

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
                _reply_in_same_thread(message, response)

            elif result["status"] == "quota_exceeded":
                _reply_in_same_thread(
                    message,
                    f"Лимит генераций достигнут.\n\n{_plain(result.get('message', 'Месячный лимит исчерпан.'))}",
                )
            
        except Exception as e:
            logger.error(f"Error: {e}")
            _reply_in_same_thread(message, f"❌ Ошибка: {str(e)}")
        return

    lowered_text = message.text.lower()
    if any(trigger in lowered_text for trigger in ["подключ", "как подключ", "help", "/help", "старт", "start"]):
        _reply_in_same_thread(
            message,
            build_commands_help_message(message, config=config, is_admin=bool(access.get("is_admin"))),
        )

if __name__ == "__main__":
    init_db()
    if ADMIN_TELEGRAM_IDS:
        logger.info("Configured Telegram admin ids: %s", ", ".join(str(v) for v in sorted(ADMIN_TELEGRAM_IDS)))
    else:
        logger.warning("TELEGRAM_ADMIN_IDS is not configured. New access requests cannot be approved automatically.")
    if not WEBAPP_BASE_URL:
        logger.warning("WEBAPP_BASE_URL is not configured. Telegram web login callback links will be unavailable.")
    logger.info("Starting Multi-Client Bot...")
    bot.infinity_polling()
