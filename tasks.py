"""
Оркестрация задач: генерация, публикация, уведомления.
"""

import json
import logging
import random
import re
from datetime import datetime, timedelta

import config
import generator
import research
import telegram_api
from database import session, Channel, ChannelRule, Source, Post, User
from sqlmodel import select

logger = logging.getLogger(__name__)

LOW_TOKENS_THRESHOLD = 20000  # ~1 пост


def _looks_like_menu(text: str) -> bool:
    text_stripped = text.strip()
    lines = text_stripped.split("\n")
    bullet_lines = sum(1 for l in lines if re.match(r"^\s*[-•*\d]", l))
    if bullet_lines >= 3 and len(lines) <= 15:
        if "?" in text_stripped[:200]:
            return True
    if re.search(r"(напиши тему|какую тему|что именно|уточни|подскажи)\s*[.?]?\s*$", text_stripped, re.IGNORECASE):
        return True
    return False


async def _notify_user(user: User, text: str):
    """Отправляет уведомление пользователю в Telegram если подключён."""
    if not user.tg_chat_id:
        return
    ok, err = await telegram_api.send_notification(user.tg_chat_id, text)
    if not ok:
        logger.warning(f"Уведомление пользователю {user.id}: {err}")


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
        # Загружаем правила канала
        rules = s.exec(select(ChannelRule).where(ChannelRule.channel_id == channel_id)).all()
        rules_text = "\n".join(f"• {r.rule_text}" for r in rules) if rules else ""

    material = ""
    if source_urls:
        try:
            material = await research.fetch_sources(source_urls)
        except Exception as e:
            logger.warning(f"Ошибка сбора источников: {e}")

    try:
        text, tokens = await generator.generate_post(channel, material, topic, rules_text)
    except Exception as e:
        logger.error(f"Ошибка генерации канала {channel_id}: {e}")
        return {"ok": False, "message": f"Ошибка генерации: {e}"}

    if _looks_like_menu(text):
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
        prev_balance = user.token_balance
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

        # Уведомления
        if user.notify_new_post and post.status == "pending":
            await _notify_user(user, f"✦ <b>Новый пост готов</b>\n\nКанал: {channel.title}\n\n{text[:200]}{'...' if len(text) > 200 else ''}")
        if user.notify_published and post.status == "published":
            await _notify_user(user, f"✅ <b>Пост опубликован</b>\n\nКанал: {channel.title}")
        # Предупреждение о токенах
        if user.notify_low_tokens and prev_balance > LOW_TOKENS_THRESHOLD and user.token_balance <= LOW_TOKENS_THRESHOLD:
            await _notify_user(user, f"⚠️ <b>Токены заканчиваются</b>\n\nОсталось ~1 пост. Пополните баланс в приложении.")

    return {"ok": True, "message": "Черновик создан", "post_id": pid, "tokens_used": tokens}


async def publish_post(post_id: int) -> dict:
    with session() as s:
        post = s.get(Post, post_id)
        if not post:
            return {"ok": False, "message": "Пост не найден"}
        channel = s.get(Channel, post.channel_id)
        user = s.get(User, post.user_id)
        text = post.text
        chat = channel.tg_chat

    result = await telegram_api.send_message(chat, text)
    if not result.get("ok"):
        return {"ok": False, "message": f"Telegram: {result.get('description')}"}

    with session() as s:
        post = s.get(Post, post_id)
        channel = s.get(Channel, post.channel_id)
        user = s.get(User, post.user_id)
        post.status = "published"
        post.published_at = datetime.utcnow()
        post.tg_message_id = result["result"].get("message_id")
        s.add(post); s.commit()

        if user and user.notify_published:
            await _notify_user(user, f"✅ <b>Пост опубликован</b>\n\nКанал: {channel.title if channel else ''}")

    return {"ok": True, "message": "Опубликовано"}


def _next_publish_time(channel: Channel, now: datetime) -> datetime:
    """Вычисляет следующее время генерации с учётом jitter и окна публикации."""
    base_seconds = channel.interval_hours * 3600
    jitter = channel.interval_jitter_minutes or 0
    if jitter > 0:
        delta = random.randint(-jitter * 60, jitter * 60)
        base_seconds = max(60, base_seconds + delta)

    next_time = (channel.last_generated_at or now) + timedelta(seconds=base_seconds)

    # Применяем окно публикации
    ws = channel.publish_window_start
    we = channel.publish_window_end
    if ws and we:
        try:
            wsh, wsm = map(int, ws.split(":"))
            weh, wem = map(int, we.split(":"))
            window_start = next_time.replace(hour=wsh, minute=wsm, second=0, microsecond=0)
            window_end = next_time.replace(hour=weh, minute=wem, second=0, microsecond=0)

            if next_time < window_start:
                next_time = window_start
            elif next_time > window_end:
                # Переносим на начало следующего дня
                next_time = (next_time + timedelta(days=1)).replace(hour=wsh, minute=wsm, second=0)
        except Exception:
            pass

    return next_time


def _is_due(channel: Channel, now: datetime) -> bool:
    if channel.schedule_kind == "interval":
        if channel.last_generated_at is None:
            # Проверяем окно если задано
            ws = channel.publish_window_start
            we = channel.publish_window_end
            if ws and we:
                try:
                    wsh, wsm = map(int, ws.split(":"))
                    weh, wem = map(int, we.split(":"))
                    cur_minutes = now.hour * 60 + now.minute
                    start_minutes = wsh * 60 + wsm
                    end_minutes = weh * 60 + wem
                    if not (start_minutes <= cur_minutes <= end_minutes):
                        return False
                except Exception:
                    pass
            return True
        next_time = _next_publish_time(channel, now)
        return now >= next_time

    if channel.schedule_kind == "daily":
        try:
            times = json.loads(channel.daily_times or "[]")
        except Exception:
            times = []
        hhmm = now.strftime("%H:%M")
        if hhmm in times:
            last = channel.last_generated_at
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
