"""
Telegram Bot API через httpx.
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
    return await _call("sendMessage", {
        "chat_id": chat,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": False,
    })


async def get_chat(chat: str) -> dict:
    return await _call("getChat", {"chat_id": chat})


async def verify_channel(chat: str) -> tuple[bool, str]:
    """
    Проверяет что канал существует и бот является администратором.
    Использует getChatAdministrators — надёжнее чем getChatMember.
    """
    # Шаг 1: получаем info о боте
    me = await _call("getMe", {})
    if not me.get("ok"):
        return False, "Не удалось получить данные бота. Проверь TELEGRAM_BOT_TOKEN."
    bot_id = me["result"]["id"]

    # Шаг 2: проверяем что канал существует
    chat_info = await _call("getChat", {"chat_id": chat})
    if not chat_info.get("ok"):
        desc = chat_info.get("description", "канал не найден")
        # Человекочитаемые ошибки
        if "not found" in desc.lower():
            return False, f"Канал «{chat}» не найден. Проверь username — он должен совпадать точно, включая заглавные буквы."
        if "forbidden" in desc.lower():
            return False, f"Канал «{chat}» закрытый или бот не имеет доступа. Сначала добавь бота администратором."
        return False, f"Не удалось найти канал: {desc}"

    # Шаг 3: получаем список администраторов
    admins = await _call("getChatAdministrators", {"chat_id": chat})
    if not admins.get("ok"):
        desc = admins.get("description", "")
        if "not enough rights" in desc.lower() or "forbidden" in desc.lower():
            return False, "Бот не является администратором канала. Добавь @" + (config.TELEGRAM_BOT_USERNAME or "бота") + " как администратора с правом публикации."
        return False, f"Не удалось получить список администраторов: {desc}"

    # Шаг 4: ищем бота в списке
    bot_admin = None
    for admin in admins["result"]:
        if admin["user"]["id"] == bot_id:
            bot_admin = admin
            break

    if not bot_admin:
        bot_name = "@" + (config.TELEGRAM_BOT_USERNAME or "бота")
        return False, f"Бот {bot_name} не найден среди администраторов канала. Добавь его через Управление каналом → Администраторы."

    # Шаг 5: проверяем право публиковать сообщения
    status = bot_admin.get("status", "")
    can_post = bot_admin.get("can_post_messages", False)

    if status == "creator":
        return True, "Канал подключён — бот является создателем ✓"

    if not can_post:
        return False, "Бот добавлен как администратор, но у него нет права публиковать сообщения. Включи это право в настройках администратора."

    return True, "Канал подключён — бот является администратором с правом публикации ✓"
