"""
Telegram Bot API через httpx.
Включает отправку уведомлений пользователям.
"""

import logging
import re
import httpx
import config

logger = logging.getLogger(__name__)
API = "https://api.telegram.org/bot{token}/{method}"


_TME_DOMAINS = r"(?:https?://)?(?:www\.)?(?:t\.me|telegram\.me)/"
_TME_RE = re.compile(_TME_DOMAINS + r"([A-Za-z0-9_]+)/?$", re.IGNORECASE)
_TME_PRIVATE_RE = re.compile(_TME_DOMAINS + r"\+", re.IGNORECASE)
_USERNAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{4,31}$")


class ChatNormalizationError(Exception):
    """Невалидный ввод канала -- готовое русское сообщение для пользователя."""
    pass


def normalize_chat(raw: str) -> str:
    """
    Приводит любой формат идентификатора канала к виду, который понимает
    Telegram Bot API: @username или числовой chat_id.

    Принимает: @LeoBel_AI, LeoBel_AI, https://t.me/LeoBel_AI, t.me/LeoBel_AI,
    http://t.me/LeoBel_AI, https://telegram.me/LeoBel_AI, www.t.me/LeoBel_AI,
    числовой chat_id (-1001234567890).

    Это нужно делать ВСЕГДА перед любым вызовом Bot API (sendMessage, getChat,
    getChatAdministrators) -- нельзя полагаться на то, что в БД уже сохранён
    правильный формат, потому что пользователь может вставить полную ссылку
    при подключении канала.

    Бросает ChatNormalizationError с готовым русским сообщением, если ввод
    нельзя нормализовать (приватная ссылка t.me/+..., мусорный ввод).
    """
    chat = (raw or "").strip()
    if not chat:
        raise ChatNormalizationError("Введите @username или ссылку на канал.")

    # Приватные ссылки-приглашения (t.me/+abc123) -- не username, отдельная ошибка.
    if _TME_PRIVATE_RE.search(chat):
        raise ChatNormalizationError(
            "Сейчас поддерживаются только публичные каналы с username. "
            "Добавьте публичный @username канала или используйте публичную ссылку t.me/username."
        )

    # Полная ссылка на t.me/telegram.me в любом регистре, с протоколом или без.
    m = _TME_RE.search(chat)
    if m:
        username = m.group(1)
        if _USERNAME_RE.match(username):
            return "@" + username
        raise ChatNormalizationError(
            "Проверьте username канала. Он должен выглядеть как @channel_name или https://t.me/channel_name."
        )

    # Числовой chat_id (например -1001234567890) -- передаём как есть.
    if chat.lstrip("-").isdigit():
        return chat

    # @username или просто username без @.
    bare = chat.lstrip("@")
    if _USERNAME_RE.match(bare):
        return "@" + bare

    # Ничего не подошло -- явно невалидный ввод (например обрывок ссылки,
    # случайный текст, "@T.me/..." без распознаваемого username).
    raise ChatNormalizationError(
        "Проверьте username канала. Он должен выглядеть как @channel_name или https://t.me/channel_name."
    )


async def _call(method: str, payload: dict) -> dict:
    if not config.TELEGRAM_BOT_TOKEN:
        return {"ok": False, "description": "TELEGRAM_BOT_TOKEN не задан"}
    url = API.format(token=config.TELEGRAM_BOT_TOKEN, method=method)
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, json=payload)
        return r.json()


async def send_message(chat: str, text: str) -> dict:
    try:
        normalized = normalize_chat(chat)
    except ChatNormalizationError as e:
        # Сохраняем контракт функции (всегда dict с ok/description), не
        # пробрасываем исключение -- publish_post в tasks.py ожидает именно
        # такую форму ответа.
        return {"ok": False, "description": str(e)}
    return await _call("sendMessage", {
        "chat_id": normalized,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": False,
    })


async def send_notification(tg_chat_id: int, text: str) -> tuple[bool, str]:
    """
    Отправляет уведомление пользователю по его числовому chat_id.
    Возвращает (ok, error_message).
    """
    if not tg_chat_id:
        return False, "Telegram не подключён"

    result = await _call("sendMessage", {
        "chat_id": tg_chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    })

    if result.get("ok"):
        return True, ""

    desc = result.get("description", "неизвестная ошибка").lower()
    if "chat not found" in desc or "user not found" in desc:
        return False, "Пользователь не найден. Убедитесь что вы написали /start боту."
    if "blocked" in desc or "bot was blocked" in desc:
        return False, "Пользователь заблокировал бота."
    if "deactivated" in desc:
        return False, "Аккаунт пользователя удалён."
    if "forbidden" in desc:
        return False, "Нет доступа. Напишите /start боту @" + (config.TELEGRAM_BOT_USERNAME or "боту")
    return False, f"Ошибка отправки: {result.get('description', '')}"


async def verify_channel(chat: str) -> tuple[bool, str]:
    """Проверяет что канал существует и бот является администратором."""
    raw_chat = chat
    try:
        chat = normalize_chat(chat)
    except ChatNormalizationError as e:
        logger.info(f"channel_input_raw=«{raw_chat}» channel_username_normalized=FAILED verification_error_code=normalization_failed")
        return False, str(e)
    logger.info(f"channel_input_raw=«{raw_chat}» channel_username_normalized=«{chat}»")

    me = await _call("getMe", {})
    if not me.get("ok"):
        return False, "Не удалось получить данные бота. Проверь TELEGRAM_BOT_TOKEN."
    bot_id = me["result"]["id"]

    chat_info = await _call("getChat", {"chat_id": chat})
    if not chat_info.get("ok"):
        desc = chat_info.get("description", "")
        if "not found" in desc.lower():
            logger.info(f"verification_error_code=chat_not_found channel_username_normalized=«{chat}»")
            return False, f"Канал «{chat}» не найден. Проверь username точно как в ссылке канала."
        if "forbidden" in desc.lower():
            logger.info(f"verification_error_code=chat_forbidden channel_username_normalized=«{chat}»")
            return False, f"Нет доступа к каналу «{chat}». Сначала добавь бота администратором."
        logger.info(f"verification_error_code=chat_lookup_failed channel_username_normalized=«{chat}»")
        return False, f"Не удалось найти канал: {desc}"

    admins = await _call("getChatAdministrators", {"chat_id": chat})
    bot_name = "@" + (config.TELEGRAM_BOT_USERNAME or "Trpst_bot")
    if not admins.get("ok"):
        desc = admins.get("description", "")
        if "not enough rights" in desc.lower() or "forbidden" in desc.lower():
            logger.info(f"verification_error_code=bot_not_admin channel_username_normalized=«{chat}»")
            return False, f"Бот пока не найден в канале. Проверьте, что вы добавили {bot_name} администратором канала."
        logger.info(f"verification_error_code=admins_lookup_failed channel_username_normalized=«{chat}»")
        return False, f"Не удалось получить список администраторов: {desc}"

    bot_admin = next((a for a in admins["result"] if a["user"]["id"] == bot_id), None)

    if not bot_admin:
        logger.info(f"verification_error_code=wrong_bot channel_username_normalized=«{chat}»")
        return False, f"Похоже, добавлен не тот бот. Для публикации нужен {bot_name}."

    if bot_admin.get("status") == "creator":
        logger.info(f"verification_error_code=none channel_username_normalized=«{chat}»")
        return True, "Канал подключён — бот является создателем ✓"

    if not bot_admin.get("can_post_messages", False):
        logger.info(f"verification_error_code=no_post_rights channel_username_normalized=«{chat}»")
        return False, "Бот найден, но у него нет права публиковать сообщения. Дайте право «Публиковать сообщения»."

    logger.info(f"verification_error_code=none channel_username_normalized=«{chat}»")
    return True, "Канал подключён — бот является администратором ✓"
