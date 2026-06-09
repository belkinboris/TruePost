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

    # Загружаем заголовки последних постов чтобы не повторять темы
    recent_titles = ""
    try:
        with session() as s:
            from sqlmodel import select as sel
            recent_posts = s.exec(
                sel(Post).where(
                    Post.channel_id == channel_id,
                    Post.status == "published"
                ).order_by(Post.published_at.desc()).limit(30)
            ).all()
            titles = []
            for p in recent_posts:
                first_line = p.text.strip().split("\n")[0]
                # Убираем HTML теги для читаемости
                import re as _re
                first_line = _re.sub(r"<[^>]+>", "", first_line).strip()
                if first_line:
                    titles.append(f"- {first_line[:120]}")
            if titles:
                recent_titles = "\n".join(titles)
    except Exception as e:
        logger.warning(f"Ошибка загрузки заголовков: {e}")

    material = ""
    if source_urls:
        try:
            material = await research.fetch_sources(source_urls)
        except Exception as e:
            logger.warning(f"Ошибка сбора источников: {e}")

    # Для новостных каналов — сначала проверяем есть ли свежие новости
    if getattr(channel, "channel_type", "thematic") == "news" and not topic:
        try:
            has_news, check_tokens = await generator.check_news_available(channel)
            if not has_news:
                logger.info(f"Канал {channel_id}: новостей нет, пропускаем генерацию")
                # Списываем минимум токенов за проверку
                with session() as s:
                    u = s.get(User, channel.user_id)
                    if u:
                        u.token_balance = max(0, u.token_balance - check_tokens)
                        s.add(u); s.commit()
                return {"ok": True, "message": "Новостей нет, публикация пропущена", "skipped": True}
        except Exception as e:
            logger.warning(f"Ошибка проверки новостей: {e}")

    try:
        text, tokens = await generator.generate_post(channel, material, topic, rules_text, recent_titles)
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

    # Если пост сразу опубликован (автопилот) — догенерируем очередь
    if pid:
        with session() as s:
            p = s.get(Post, pid)
            if p and p.status == "published":
                try:
                    await _ensure_queue(pid)
                except Exception as e:
                    logger.warning(f"auto-refill after publish: {e}")

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

    # Автодогенерация: держим минимум 3 поста в очереди
    try:
        await _ensure_queue(post_id)
    except Exception as e:
        logger.warning(f"auto-refill failed: {e}")

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
            # Первая генерация — проверяем окно если задано
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
        # Строго проверяем что прошёл нужный интервал
        min_seconds = channel.interval_hours * 3600
        elapsed = (now - channel.last_generated_at).total_seconds()
        if elapsed < min_seconds * 0.9:  # 10% допуск
            return False
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


_last_update_id = 0

async def _process_bot_updates():
    """Получает обновления от бота и привязывает chat_id к аккаунтам."""
    global _last_update_id
    import telegram_api as tg
    result = await tg._call("getUpdates", {
        "offset": _last_update_id + 1,
        "timeout": 0,
        "limit": 100,
        "allowed_updates": ["message"]
    })
    if not result.get("ok"):
        return
    updates = result.get("result", [])
    for upd in updates:
        _last_update_id = upd["update_id"]
        msg = upd.get("message", {})
        text = msg.get("text", "")
        chat_id = msg.get("chat", {}).get("id")
        if not text.startswith("/start") or not chat_id:
            continue
        parts = text.strip().split()
        user_id = None
        if len(parts) > 1 and parts[1].startswith("u"):
            try:
                user_id = int(parts[1][1:])
            except ValueError:
                pass
        if user_id:
            with session() as s:
                u = s.get(User, user_id)
                if u and u.tg_chat_id != chat_id:
                    u.tg_chat_id = chat_id
                    s.add(u); s.commit()
                    # Приветствие
                    await tg.send_notification(chat_id,
                        "✅ Аккаунт подключён! Теперь буду присылать уведомления об Автопост.")
                    logger.info(f"Linked tg_chat_id={chat_id} to user_id={user_id}")


MIN_QUEUE = 3  # минимум постов в очереди

async def _ensure_queue(published_post_id: int):
    """После публикации проверяет очередь и догенерирует если меньше MIN_QUEUE."""
    with session() as s:
        post = s.get(Post, published_post_id)
        if not post:
            return
        channel_id = post.channel_id
        channel = s.get(Channel, channel_id)
        if not channel or not channel.enabled:
            return
        from sqlmodel import select as sel
        pending_count = len(s.exec(
            sel(Post).where(
                Post.channel_id == channel_id,
                Post.status.in_(["pending", "scheduled"])
            )
        ).all())

    if pending_count < MIN_QUEUE:
        for _ in range(MIN_QUEUE - pending_count):
            try:
                await generate_for_channel(channel_id)
            except Exception as e:
                logger.warning(f"auto-refill gen: {e}")
                break


async def tick():
    now = datetime.utcnow()

    # Polling Telegram bot updates для привязки chat_id
    try:
        await _process_bot_updates()
    except Exception as e:
        logger.warning(f"bot polling: {e}")

    with session() as s:
        channels = s.exec(select(Channel).where(Channel.enabled == True)).all()  # noqa
        due_ids = [c.id for c in channels if c.verified and _is_due(c, now)]

    for cid in due_ids:
        try:
            await generate_for_channel(cid)
        except Exception as e:
            logger.error(f"tick: канал {cid}: {e}")

    # Держим минимум 3 поста в очереди для ВСЕХ верифицированных каналов
    with session() as s:
        all_verified = s.exec(select(Channel).where(
            Channel.enabled == True,   # noqa
            Channel.verified == True,  # noqa
        )).all()
        all_verified_ids = [c.id for c in all_verified]

    for cid in all_verified_ids:
        try:
            with session() as s:
                from sqlmodel import select as sel
                pending = s.exec(sel(Post).where(
                    Post.channel_id == cid,
                    Post.status.in_(["pending", "scheduled"])
                )).all()
                count = len(pending)
            if count < MIN_QUEUE:
                # Генерируем без автопубликации — чтобы посты были видны в очереди
                with session() as s:
                    ch = s.get(Channel, cid)
                    orig_auto = ch.auto_publish
                    ch.auto_publish = False
                    s.add(ch); s.commit()
                try:
                    for _ in range(MIN_QUEUE - count):
                        result = await generate_for_channel(cid)
                        if not result.get("ok"):
                            break
                finally:
                    # Восстанавливаем auto_publish
                    with session() as s:
                        ch = s.get(Channel, cid)
                        if ch:
                            ch.auto_publish = orig_auto
                            s.add(ch); s.commit()
        except Exception as e:
            logger.warning(f"queue-refill канал {cid}: {e}")

    with session() as s:
        from database import due_scheduled_posts
        due_posts = [p.id for p in due_scheduled_posts(s, now)]

    for pid in due_posts:
        try:
            await publish_post(pid)
        except Exception as e:
            logger.error(f"tick: пост {pid}: {e}")
