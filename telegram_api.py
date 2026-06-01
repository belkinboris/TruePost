"""
Тонкая обёртка над Telegram Bot API.
Используется ОДИН бот платформы (config.TELEGRAM_BOT_TOKEN).
"""

import logging
import httpx
import config

logger = logging.getLogger(__name__)

API = "https://api.telegram.org/bot{token}/{method}"


async def _call(method: str, payload: dict) -> dict:
    if not config.TELEGRAM_BOT_TOKEN:
        return {"ok": False, "description": "TELEGRAM_BOT_TOKEN не задан"}
    url = API.format(token=config.TELEGRAM_BOT_TOKEN, method=method)
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, json=payload)
        return r.json()


async def send_message(chat: str, text: str) -> dict:
    """Публикует текстовое сообщение в канал. chat — @username или -100… id."""
    return await _call("sendMessage", {
        "chat_id": chat,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": False,
    })


async def get_chat(chat: str) -> dict:
    return await _call("getChat", {"chat_id": chat})


async def get_bot_member(chat: str) -> dict:
    """Проверяет, что бот добавлен в канал админом."""
    me = await _call("getMe", {})
    if not me.get("ok"):
        return {"ok": False, "description": "Бот недоступен. Проверь TELEGRAM_BOT_TOKEN."}
    bot_id = me["result"]["id"]
    return await _call("getChatMember", {"chat_id": chat, "user_id": bot_id})


async def verify_channel(chat: str) -> tuple[bool, str]:
    """
    Возвращает (ок, сообщение). Проверяет что канал существует и бот — админ.
    """
    member = await get_bot_member(chat)
    if not member.get("ok"):
        desc = member.get("description", "не удалось проверить канал")
        return False, f"Не вижу канал или бот не добавлен: {desc}"
    status = member["result"].get("status")
    if status not in ("administrator", "creator"):
        return False, "Бот добавлен, но НЕ является администратором канала. Дай ему право публиковать сообщения."
    return True, "Канал подключён, бот — администратор ✅"
