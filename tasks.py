"""
Оркестрация задач: генерация черновика для канала и публикация постов.
Используется и планировщиком, и обработчиками API.
"""

import json
import logging
from datetime import datetime

import config
import generator
import research
import telegram_api
from database import session, Channel, Source, Post, User
from sqlmodel import select

logger = logging.getLogger(__name__)


async def generate_for_channel(channel_id: int) -> dict:
    """
    Генерирует один черновик поста для канала.
    Списывает токены с владельца. Если auto_publish — сразу публикует.
    Возвращает {ok, message, post_id?}.
    """
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
            select(Source).where(Source.channel_id == channel_id, Source.enabled == True)  # noqa: E712
        ).all()
        source_urls = [src.url for src in sources]

    # Качаем источники (вне сессии БД — это сетевые запросы)
    material = ""
    if source_urls:
        try:
            material = await research.fetch_sources(source_urls)
        except Exception as e:
            logger.warning(f"Ошибка сбора источников: {e}")

    # Генерация
    try:
        text, tokens = await generator.generate_post(channel, material)
    except Exception as e:
        logger.error(f"Ошибка генерации для канала {channel_id}: {e}")
        return {"ok": False, "message": f"Ошибка генерации: {e}"}

    # Сохраняем пост + списываем токены
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
            else:
                # не смогли опубликовать — оставим на ревью
                post.status = "pending"

        s.add(post)
        s.add(user)
        s.add(channel)
        s.commit()
        s.refresh(post)
        pid = post.id

    return {"ok": True, "message": "Черновик создан", "post_id": pid, "tokens_used": tokens}


async def publish_post(post_id: int) -> dict:
    """Публикует конкретный пост в его канал прямо сейчас."""
    with session() as s:
        post = s.get(Post, post_id)
        if not post:
            return {"ok": False, "message": "Пост не найден"}
        channel = s.get(Channel, post.channel_id)
        text = post.text
        chat = channel.tg_chat

    result = await telegram_api.send_message(chat, text)
    if not result.get("ok"):
        return {"ok": False, "message": f"Telegram отказал: {result.get('description')}"}

    with session() as s:
        post = s.get(Post, post_id)
        post.status = "published"
        post.published_at = datetime.utcnow()
        post.tg_message_id = result["result"].get("message_id")
        s.add(post)
        s.commit()
    return {"ok": True, "message": "Опубликовано"}


def _is_due(channel: Channel, now: datetime) -> bool:
    """Пора ли генерировать новый пост для канала."""
    last = channel.last_generated_at

    if channel.schedule_kind == "interval":
        if last is None:
            return True
        hours = max(1, channel.interval_hours)
        return (now - last).total_seconds() >= hours * 3600

    if channel.schedule_kind == "daily":
        try:
            times = json.loads(channel.daily_times or "[]")
        except Exception:
            times = []
        # генерируем, если сейчас попали в минуту одного из слотов
        # и в этот слот сегодня ещё не генерировали
        hhmm_now = now.strftime("%H:%M")
        if hhmm_now in times:
            if last is None:
                return True
            return not (last.date() == now.date() and last.strftime("%H:%M") == hhmm_now)
    return False


async def tick():
    """Один проход планировщика: генерация по расписанию + публикация отложенных."""
    now = datetime.utcnow()

    # 1) генерация по расписанию
    with session() as s:
        channels = s.exec(select(Channel).where(Channel.enabled == True)).all()  # noqa: E712
        due_ids = [c.id for c in channels if c.verified and _is_due(c, now)]

    for cid in due_ids:
        try:
            await generate_for_channel(cid)
        except Exception as e:
            logger.error(f"tick: ошибка генерации канала {cid}: {e}")

    # 2) публикация запланированных постов, у которых наступило время
    with session() as s:
        from database import due_scheduled_posts
        due_posts = [p.id for p in due_scheduled_posts(s, now)]

    for pid in due_posts:
        try:
            await publish_post(pid)
        except Exception as e:
            logger.error(f"tick: ошибка публикации поста {pid}: {e}")
