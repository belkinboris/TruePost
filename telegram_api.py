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


def _normalize_chat(chat: str) -> str:
    """
    Приводит любой формат идентификатора канала к виду, который понимает
    Telegram Bot API: @username или числовой chat_id.

    Принимает: https://t.me/name, t.me/name, @name, name, -1001234567890.
    Это нужно делать ВСЕГДА перед любым вызовом Bot API (sendMessage,
    getChat, getChatAdministrators) -- нельзя полагаться на то, что в БД
    уже сохранён правильный формат, потому что пользователь может вставить
    полную ссылку при подключении канала.
    """
    chat = (chat or "").strip()
    if not chat:
        return chat
    m = re.search(r"t\.me/([A-Za-z0-9_]+)", chat)
    if m:
        return "@" + m.group(1)
    if chat.startswith("@") or chat.lstrip("-").isdigit():
        return chat
    return "@" + chat


async def _call(method: str, payload: dict) -> dict:
    if not config.TELEGRAM_BOT_TOKEN:
        return {"ok": False, "description": "TELEGRAM_BOT_TOKEN не задан"}
    url = API.format(token=config.TELEGRAM_BOT_TOKEN, method=method)
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, json=payload)
        return r.json()


async def send_message(chat: str, text: str) -> dict:
    return await _call("sendMessage", {
        "chat_id": _normalize_chat(chat),
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
    chat = _normalize_chat(chat)

    me = await _call("getMe", {})
    if not me.get("ok"):
        return False, "Не удалось получить данные бота. Проверь TELEGRAM_BOT_TOKEN."
    bot_id = me["result"]["id"]

    chat_info = await _call("getChat", {"chat_id": chat})
    if not chat_info.get("ok"):
        desc = chat_info.get("description", "")
        if "not found" in desc.lower():
            return False, f"Канал «{chat}» не найден. Проверь username точно как в ссылке канала."
        if "forbidden" in desc.lower():
            return False, f"Нет доступа к каналу «{chat}». Сначала добавь бота администратором."
        return False, f"Не удалось найти канал: {desc}"

    admins = await _call("getChatAdministrators", {"chat_id": chat})
    bot_name = "@" + (config.TELEGRAM_BOT_USERNAME or "Trpst_bot")
    if not admins.get("ok"):
        desc = admins.get("description", "")
        if "not enough rights" in desc.lower() or "forbidden" in desc.lower():
            return False, f"Бот пока не найден в канале. Проверьте, что вы добавили {bot_name} администратором канала."
        return False, f"Не удалось получить список администраторов: {desc}"

    bot_admin = next((a for a in admins["result"] if a["user"]["id"] == bot_id), None)

    if not bot_admin:
        return False, f"Похоже, добавлен не тот бот. Для публикации нужен {bot_name}."

    if bot_admin.get("status") == "creator":
        return True, "Канал подключён — бот является создателем ✓"

    if not bot_admin.get("can_post_messages", False):
        return False, "Бот найден, но у него нет права публиковать сообщения. Дайте право «Публиковать сообщения»."

    return True, "Канал подключён — бот является администратором ✓"
