"""
Оркестрация задач: генерация черновика и публикация постов.
"""

import json
import logging
import re
from datetime import datetime

import config
import generator
import research
import telegram_api
from database import session, Channel, Source, Post, User
from sqlmodel import select

logger = logging.getLogger(__name__)


def _looks_like_menu(text: str) -> bool:
    """Проверяет что текст — это вопрос/меню, а не пост."""
    text_stripped = text.strip()
    lines = text_stripped.split("\n")
    # Много строк начинающихся с тире или буллета — это меню
    bullet_lines = sum(1 for l in lines if re.match(r"^\s*[-•*\d]", l))
    if bullet_lines >= 3 and len(lines) <= 15:
        # Дополнительно проверяем что есть вопрос
        if "?" in text_stripped[:200]:
            return True
    # Заканчивается на вопрос про тему
    if re.search(r"(напиши тему|какую тему|что именно|уточни|подскажи)\s*[.?]?\s*$", text_stripped, re.IGNORECASE):
        return True
    return False


async def generate_for_channel(channel_id: int, topic: str = "") -> dict:
    with session() as s:
        channel = s.get(Channel, channel_id)
        if not channel:
            return {"ok": False, "message": "Канал не найден"}
        user = s.get(User, channel.user_id)
        if not user:
            return {"ok": False, "message": "Владелец не найден"}
        if user.token_balance <= 0:
            return {"ok": False, "message": "Закончились токены. Пополните баланс."}
        sources = s.exec(
            select(Source).where(Source.channel_id == channel_id, Source.enabled == True)  # noqa
        ).all()
        source_urls = [src.url for src in sources]

    material = ""
    if source_urls:
        try:
            material = await research.fetch_sources(source_urls)
        except Exception as e:
            logger.warning(f"Ошибка сбора источников: {e}")

    try:
        text, tokens = await generator.generate_post(channel, material, topic)
    except Exception as e:
        logger.error(f"Ошибка генерации канала {channel_id}: {e}")
        return {"ok": False, "message": f"Ошибка генерации: {e}"}

    # Защита: если вместо поста пришло меню/вопрос — не сохраняем
    if _looks_like_menu(text):
        logger.warning(f"Канал {channel_id}: Claude вернул меню вместо поста, пропускаем")
        return {"ok": False, "message": "ИИ не смог определить тему. Задайте тему поста вручную."}

    with session() as s:
        channel = s.get(Channel, channel_id)
        user = s.get(User, channel.user_id)
        post = Post(
            channel_id=channel_id,
            user_id=channel.user_id,
            text=text,
            tokens_used=tokens,
            status="pending",
        )
        user.token_balance = max(0, user.token_balance - tokens)
        channel.last_generated_at = datetime.utcnow()

        if channel.auto_publish:
            result = await telegram_api.send_message(channel.tg_chat, text)
            if result.get("ok"):
                post.status = "published"
                post.published_at = datetime.utcnow()
                post.tg_message_id = result["result"].get("message_id")

        s.add(post); s.add(user); s.add(channel)
        s.commit(); s.refresh(post)
        pid = post.id

    return {"ok": True, "message": "Черновик создан", "post_id": pid, "tokens_used": tokens}


async def publish_post(post_id: int) -> dict:
    with session() as s:
        post = s.get(Post, post_id)
        if not post:
            return {"ok": False, "message": "Пост не найден"}
        channel = s.get(Channel, post.channel_id)
        text = post.text
        chat = channel.tg_chat

    result = await telegram_api.send_message(chat, text)
    if not result.get("ok"):
        return {"ok": False, "message": f"Telegram: {result.get('description')}"}

    with session() as s:
        post = s.get(Post, post_id)
        post.status = "published"
        post.published_at = datetime.utcnow()
        post.tg_message_id = result["result"].get("message_id")
        s.add(post); s.commit()
    return {"ok": True, "message": "Опубликовано"}


def _is_due(channel: Channel, now: datetime) -> bool:
    last = channel.last_generated_at
    if channel.schedule_kind == "interval":
        if last is None:
            return True
        return (now - last).total_seconds() >= max(1, channel.interval_hours) * 3600
    if channel.schedule_kind == "daily":
        try:
            times = json.loads(channel.daily_times or "[]")
        except Exception:
            times = []
        hhmm = now.strftime("%H:%M")
        if hhmm in times:
            if last is None:
                return True
            return not (last.date() == now.date() and last.strftime("%H:%M") == hhmm)
    return False


async def tick():
    now = datetime.utcnow()
    with session() as s:
        channels = s.exec(select(Channel).where(Channel.enabled == True)).all()  # noqa
        due_ids = [c.id for c in channels if c.verified and _is_due(c, now)]

    for cid in due_ids:
        try:
            await generate_for_channel(cid)
        except Exception as e:
            logger.error(f"tick: канал {cid}: {e}")

    with session() as s:
        from database import due_scheduled_posts
        due_posts = [p.id for p in due_scheduled_posts(s, now)]

    for pid in due_posts:
        try:
            await publish_post(pid)
        except Exception as e:
            logger.error(f"tick: пост {pid}: {e}")
