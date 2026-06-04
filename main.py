"""
Автопост — FastAPI приложение.
Запускает API + раздаёт сайт + планировщик.
"""

import json
import logging
import secrets
import string
from contextlib import asynccontextmanager
from datetime import datetime

import uvicorn
from fastapi import FastAPI, Depends, HTTPException, Request, Header
from fastapi.responses import PlainTextResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import select

import config
import security
import billing
import generator
import research
import telegram_api
import tasks
from database import (
    init_db, session,
    User, Channel, Source, Post, Payment, Referral,
)
from schemas import (
    AuthIn, ChannelIn, ChannelPatch, SourceIn,
    AnalyzeIn, AnalyzeStyleOnly, GenerateFormatIn, PostIn,
    PostPatch, ScheduleIn, BuyIn,
)

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("autopost")


# ── Планировщик ───────────────────────────────────────────────
try:
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _HAS_SCHEDULER = True
except ImportError:
    _scheduler = None
    _HAS_SCHEDULER = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("БД готова")
    if _HAS_SCHEDULER and _scheduler:
        _scheduler.add_job(
            tasks.tick, "interval", seconds=config.TICK_SECONDS,
            id="master_tick", replace_existing=True, max_instances=1, coalesce=True,
        )
        _scheduler.start()
        logger.info(f"Планировщик запущен, тик каждые {config.TICK_SECONDS}с")
    yield
    if _HAS_SCHEDULER and _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)


app = FastAPI(title="Автопост", lifespan=lifespan)


# ── Авторизация ───────────────────────────────────────────────

def current_user(authorization: str = Header(default="")) -> User:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Не авторизован")
    uid = security.verify_token(authorization[7:])
    if not uid:
        raise HTTPException(401, "Сессия истекла, войдите снова")
    with session() as s:
        user = s.get(User, uid)
        if not user:
            raise HTTPException(401, "Пользователь не найден")
        s.expunge(user)
        return user


def _gen_ref_code() -> str:
    chars = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(chars) for _ in range(8))


def _own_channel(s, channel_id: int, user: User) -> Channel:
    ch = s.get(Channel, channel_id)
    if not ch or ch.user_id != user.id:
        raise HTTPException(404, "Канал не найден")
    return ch


def _own_post(s, post_id: int, user: User) -> Post:
    p = s.get(Post, post_id)
    if not p or p.user_id != user.id:
        raise HTTPException(404, "Пост не найден")
    return p


# ── Мета ──────────────────────────────────────────────────────

@app.get("/api/config")
def get_config():
    return {
        "bot_username": config.TELEGRAM_BOT_USERNAME,
        "public_url": config.PUBLIC_URL,
        "packages": config.TOKEN_PACKAGES,
        "yookassa_enabled": billing.is_configured(),
        # Старый ключ оставлен для совместимости с фронтом, если браузер закэширует app.js.
        "yoomoney_enabled": billing.is_configured(),
    }


# ── Auth ──────────────────────────────────────────────────────

@app.post("/api/register")
def register(data: AuthIn):
    email = data.email.strip().lower()
    if "@" not in email or len(data.password) < 6:
        raise HTTPException(400, "Нужен корректный email и пароль от 6 символов")

    with session() as s:
        if s.exec(select(User).where(User.email == email)).first():
            raise HTTPException(400, "Пользователь с таким email уже есть")

        # Проверяем реферальный код
        referrer = None
        ref_code = (data.ref_code or "").strip().upper()
        if ref_code:
            referrer = s.exec(select(User).where(User.ref_code == ref_code)).first()

        user = User(
            email=email,
            password_hash=security.hash_password(data.password),
            token_balance=config.WELCOME_TOKENS,
            ref_code=_gen_ref_code(),
            referred_by=referrer.id if referrer else None,
        )
        s.add(user)
        s.commit()
        s.refresh(user)

        # Начисляем бонус рефереру
        if referrer:
            referrer_obj = s.get(User, referrer.id)
            if referrer_obj:
                referrer_obj.token_balance += config.REFERRAL_BONUS_TOKENS
                ref = Referral(
                    referrer_id=referrer.id,
                    referred_id=user.id,
                    bonus_tokens=config.REFERRAL_BONUS_TOKENS,
                )
                s.add(referrer_obj)
                s.add(ref)
                # Бонус новому пользователю тоже
                user.token_balance += config.REFERRAL_BONUS_TOKENS
                s.add(user)
                s.commit()
                s.refresh(user)

        return {"token": security.create_token(user.id), "email": user.email}


@app.post("/api/login")
def login(data: AuthIn):
    email = data.email.strip().lower()
    with session() as s:
        user = s.exec(select(User).where(User.email == email)).first()
        if not user or not security.verify_password(data.password, user.password_hash):
            raise HTTPException(401, "Неверный email или пароль")
        return {"token": security.create_token(user.id), "email": user.email}


@app.get("/api/me")
def me(user: User = Depends(current_user)):
    with session() as s:
        refs = s.exec(select(Referral).where(Referral.referrer_id == user.id)).all()
        count = len(refs)
    return {
        "email": user.email,
        "token_balance": user.token_balance,
        "is_admin": user.is_admin,
        "ref_code": user.ref_code,
        "referrals_count": count,
    }


# ── Каналы ────────────────────────────────────────────────────

def _channel_dict(ch: Channel) -> dict:
    d = ch.model_dump()
    try:
        d["daily_times"] = json.loads(ch.daily_times or "[]")
    except Exception:
        d["daily_times"] = []
    return d


@app.get("/api/channels")
def list_channels(user: User = Depends(current_user)):
    with session() as s:
        chans = s.exec(select(Channel).where(Channel.user_id == user.id)).all()
        return [_channel_dict(c) for c in chans]


@app.post("/api/channels")
def create_channel(data: ChannelIn, user: User = Depends(current_user)):
    with session() as s:
        ch = Channel(
            user_id=user.id,
            title=data.title,
            tg_chat=data.tg_chat.strip(),
            about=data.about,
            style=data.style,
            style_profile=data.style_profile,
            post_length=data.post_length,
            language=data.language,
            post_voice=data.post_voice,
            post_format=data.post_format,
            emoji_style=data.emoji_style,
            cta_enabled=data.cta_enabled,
            cta_text=data.cta_text,
            use_web_search=data.use_web_search,
            auto_publish=data.auto_publish,
            schedule_kind=data.schedule_kind,
            interval_hours=data.interval_hours,
            daily_times=json.dumps(data.daily_times),
            enabled=data.enabled,
            onboarded=data.onboarded,
        )
        s.add(ch)
        s.commit()
        s.refresh(ch)
        return _channel_dict(ch)


@app.get("/api/channels/{channel_id}")
def get_channel(channel_id: int, user: User = Depends(current_user)):
    with session() as s:
        return _channel_dict(_own_channel(s, channel_id, user))


@app.patch("/api/channels/{channel_id}")
def patch_channel(channel_id: int, data: ChannelPatch, user: User = Depends(current_user)):
    with session() as s:
        ch = _own_channel(s, channel_id, user)
        payload = data.model_dump(exclude_none=True)
        if "daily_times" in payload:
            payload["daily_times"] = json.dumps(payload["daily_times"])
        if "tg_chat" in payload:
            payload["tg_chat"] = payload["tg_chat"].strip()
            ch.verified = False
        for k, v in payload.items():
            setattr(ch, k, v)
        s.add(ch)
        s.commit()
        s.refresh(ch)
        return _channel_dict(ch)


@app.delete("/api/channels/{channel_id}")
def delete_channel(channel_id: int, user: User = Depends(current_user)):
    with session() as s:
        ch = _own_channel(s, channel_id, user)
        for src in s.exec(select(Source).where(Source.channel_id == channel_id)).all():
            s.delete(src)
        for p in s.exec(select(Post).where(Post.channel_id == channel_id)).all():
            s.delete(p)
        s.delete(ch)
        s.commit()
    return {"ok": True}


@app.post("/api/channels/{channel_id}/verify")
async def verify_channel(channel_id: int, user: User = Depends(current_user)):
    with session() as s:
        ch = _own_channel(s, channel_id, user)
        chat = ch.tg_chat
    if not chat:
        raise HTTPException(400, "Сначала укажите @username канала")
    ok, message = await telegram_api.verify_channel(chat)
    with session() as s:
        ch = _own_channel(s, channel_id, user)
        ch.verified = ok
        s.add(ch)
        s.commit()
    return {"ok": ok, "message": message}


@app.post("/api/channels/{channel_id}/generate")
async def generate_channel(channel_id: int, data: PostIn = PostIn(), user: User = Depends(current_user)):
    with session() as s:
        _own_channel(s, channel_id, user)
    result = await tasks.generate_for_channel(channel_id, topic=data.topic)
    if not result["ok"]:
        raise HTTPException(400, result["message"])
    return result


@app.post("/api/channels/{channel_id}/generate_format")
async def generate_channel_format(
    channel_id: int, data: GenerateFormatIn, user: User = Depends(current_user)
):
    """Генерирует пост в конкретном формате (для онбординга — 3 варианта)."""
    with session() as s:
        ch = _own_channel(s, channel_id, user)
        u = s.get(User, user.id)
        if u.token_balance <= 0:
            raise HTTPException(400, "Закончились токены")

    # Временно меняем формат для этой генерации
    with session() as s:
        ch = s.get(Channel, channel_id)
        original_format = ch.post_format
        ch.post_format = data.post_format
        s.add(ch)
        s.commit()

    try:
        result = await tasks.generate_for_channel(channel_id)
    finally:
        # Возвращаем оригинальный формат
        with session() as s:
            ch = s.get(Channel, channel_id)
            if ch:
                ch.post_format = original_format
                s.add(ch)
                s.commit()

    if not result["ok"]:
        raise HTTPException(400, result["message"])

    # Возвращаем текст поста напрямую для онбординга
    with session() as s:
        post = s.get(Post, result.get("post_id"))
        text = post.text if post else ""

    return {
        "ok": True,
        "post_id": result.get("post_id"),
        "text": text,
        "tokens_used": result.get("tokens_used", 0),
    }


@app.post("/api/channels/{channel_id}/analyze")
async def analyze_channel(channel_id: int, data: AnalyzeIn, user: User = Depends(current_user)):
    with session() as s:
        _own_channel(s, channel_id, user)
        u = s.get(User, user.id)
        if u.token_balance <= 0:
            raise HTTPException(400, "Закончились токены")

    posts = await research.scrape_channel(data.link)
    if not posts:
        raise HTTPException(400, "Не удалось прочитать канал. Он должен быть публичным.")

    profile, tokens = await generator.analyze_style(posts)

    with session() as s:
        ch = s.get(Channel, channel_id)
        ch.style_profile = profile
        u = s.get(User, user.id)
        u.token_balance = max(0, u.token_balance - tokens)
        s.add(ch); s.add(u); s.commit()

    return {"ok": True, "profile": profile, "analyzed_posts": len(posts), "tokens_used": tokens}


@app.post("/api/analyze_style_only")
async def analyze_style_only(data: AnalyzeStyleOnly, user: User = Depends(current_user)):
    """Анализ стиля без привязки к каналу — для онбординга."""
    with session() as s:
        u = s.get(User, user.id)
        if u.token_balance <= 0:
            raise HTTPException(400, "Закончились токены")

    posts = await research.scrape_channel(data.link)
    if not posts:
        raise HTTPException(400, "Не удалось прочитать канал. Он должен быть публичным.")

    profile, tokens = await generator.analyze_style(posts)

    with session() as s:
        u = s.get(User, user.id)
        u.token_balance = max(0, u.token_balance - tokens)
        s.add(u); s.commit()

    return {"ok": True, "profile": profile, "analyzed_posts": len(posts)}


# ── Источники ─────────────────────────────────────────────────

@app.get("/api/channels/{channel_id}/sources")
def list_sources(channel_id: int, user: User = Depends(current_user)):
    with session() as s:
        _own_channel(s, channel_id, user)
        srcs = s.exec(select(Source).where(Source.channel_id == channel_id)).all()
        return [src.model_dump() for src in srcs]


@app.post("/api/channels/{channel_id}/sources")
def add_source(channel_id: int, data: SourceIn, user: User = Depends(current_user)):
    url = data.url.strip()
    if not url.startswith("http"):
        raise HTTPException(400, "Источник должен быть ссылкой (http/https)")
    with session() as s:
        _own_channel(s, channel_id, user)
        src = Source(channel_id=channel_id, url=url)
        s.add(src); s.commit(); s.refresh(src)
        return src.model_dump()


@app.delete("/api/sources/{source_id}")
def delete_source(source_id: int, user: User = Depends(current_user)):
    with session() as s:
        src = s.get(Source, source_id)
        if not src:
            raise HTTPException(404, "Источник не найден")
        _own_channel(s, src.channel_id, user)
        s.delete(src); s.commit()
    return {"ok": True}


# ── Посты ──────────────────────────────────────────────────────

@app.get("/api/channels/{channel_id}/posts")
def list_posts(channel_id: int, user: User = Depends(current_user)):
    with session() as s:
        _own_channel(s, channel_id, user)
        posts = s.exec(
            select(Post).where(Post.channel_id == channel_id).order_by(Post.created_at.desc())
        ).all()
        return [p.model_dump() for p in posts]


@app.patch("/api/posts/{post_id}")
def edit_post(post_id: int, data: PostPatch, user: User = Depends(current_user)):
    with session() as s:
        p = _own_post(s, post_id, user)
        if p.status == "published":
            raise HTTPException(400, "Опубликованный пост нельзя редактировать")
        p.text = data.text
        s.add(p); s.commit(); s.refresh(p)
        return p.model_dump()


@app.post("/api/posts/{post_id}/publish")
async def publish(post_id: int, user: User = Depends(current_user)):
    with session() as s:
        _own_post(s, post_id, user)
    result = await tasks.publish_post(post_id)
    if not result["ok"]:
        raise HTTPException(400, result["message"])
    return result


@app.post("/api/posts/{post_id}/schedule")
def schedule_post(post_id: int, data: ScheduleIn, user: User = Depends(current_user)):
    try:
        when = datetime.fromisoformat(data.scheduled_at.replace("Z", ""))
    except Exception:
        raise HTTPException(400, "Неверный формат даты")
    with session() as s:
        p = _own_post(s, post_id, user)
        p.status = "scheduled"
        p.scheduled_at = when
        s.add(p); s.commit(); s.refresh(p)
        return p.model_dump()


@app.post("/api/posts/{post_id}/reject")
def reject_post(post_id: int, user: User = Depends(current_user)):
    with session() as s:
        p = _own_post(s, post_id, user)
        p.status = "rejected"
        s.add(p); s.commit()
    return {"ok": True}


@app.delete("/api/posts/{post_id}")
def delete_post(post_id: int, user: User = Depends(current_user)):
    with session() as s:
        p = _own_post(s, post_id, user)
        s.delete(p); s.commit()
    return {"ok": True}


# ── Биллинг ───────────────────────────────────────────────────

@app.get("/api/packages")
def packages():
    return config.TOKEN_PACKAGES


async def _sync_yookassa_pending_payments(user_id: int) -> None:
    """
    Резервная синхронизация платежей с YooKassa.

    Нужна на случай, если HTTP-уведомление YooKassa не дошло или было
    пропущено. Проверяем только платежи текущего пользователя со статусом
    pending/waiting_for_capture и уже известным operation_id = payment_id YooKassa.
    """
    if not billing.is_configured():
        return

    with session() as s:
        pending = s.exec(
            select(Payment).where(
                Payment.user_id == user_id,
                Payment.status.in_(["pending", "waiting_for_capture"]),
                Payment.operation_id != "",
            ).order_by(Payment.created_at.desc())
        ).all()
        items = [(p.id, p.operation_id) for p in pending if p.operation_id]

    for local_payment_id, yookassa_payment_id in items:
        try:
            yk_payment = await billing.get_payment(yookassa_payment_id)
        except billing.YooKassaError as exc:
            logger.warning(
                "Не удалось синхронизировать платёж YooKassa %s: %s",
                yookassa_payment_id, exc,
            )
            continue

        status = yk_payment.get("status", "")
        paid = yk_payment.get("paid") is True

        with session() as s:
            pay = s.get(Payment, local_payment_id)
            if not pay or pay.user_id != user_id:
                continue

            if status == "canceled":
                if pay.status != "paid":
                    pay.status = "canceled"
                    s.add(pay)
                    s.commit()
                continue

            if status != "succeeded" or not paid:
                if status and pay.status != status:
                    pay.status = status
                    s.add(pay)
                    s.commit()
                continue

            try:
                actual_amount = round(float((yk_payment.get("amount") or {}).get("value", 0)), 2)
            except Exception:
                actual_amount = 0
            expected_amount = round(float(pay.rub), 2)
            if actual_amount != expected_amount:
                logger.error(
                    "YooKassa sync: сумма не совпала, payment_id=%s, actual=%s, expected=%s",
                    yookassa_payment_id, actual_amount, expected_amount,
                )
                continue

            if pay.status != "paid":
                pay.status = "paid"
                pay.paid_at = datetime.utcnow()
                u = s.get(User, pay.user_id)
                if u:
                    u.token_balance += pay.tokens
                    s.add(u)
                s.add(pay)
                s.commit()
                logger.info(
                    "Платёж YooKassa зачтён через sync: пользователь %s +%s токенов",
                    pay.user_id, pay.tokens,
                )


@app.get("/api/payments")
async def payments(user: User = Depends(current_user)):
    await _sync_yookassa_pending_payments(user.id)
    with session() as s:
        ps = s.exec(
            select(Payment).where(Payment.user_id == user.id).order_by(Payment.created_at.desc())
        ).all()
        return [p.model_dump() for p in ps]


@app.post("/api/billing/buy")
async def buy(data: BuyIn, user: User = Depends(current_user)):
    pkg = config.package_by_id(data.package_id)
    if not pkg:
        raise HTTPException(400, "Пакет не найден")
    if not billing.is_configured():
        raise HTTPException(400, "Приём платежей не настроен")

    label = f"u{user.id}-{data.package_id}-{secrets.token_hex(6)}"
    description = f"Автопост: пакет «{pkg['title']}» ({pkg['tokens']} токенов)"

    with session() as s:
        pay = Payment(
            user_id=user.id,
            package_id=pkg["id"],
            label=label,
            rub=pkg["rub"],
            tokens=pkg["tokens"],
            status="pending",
        )
        s.add(pay)
        s.commit()
        s.refresh(pay)
        local_payment_id = pay.id

    try:
        yk_payment = await billing.create_payment(
            label=label,
            amount_rub=pkg["rub"],
            description=description,
            user_id=user.id,
            package_id=pkg["id"],
            user_email=user.email,
        )
    except billing.YooKassaError as exc:
        with session() as s:
            pay = s.get(Payment, local_payment_id)
            if pay:
                pay.status = "failed"
                s.add(pay)
                s.commit()
        raise HTTPException(502, str(exc))

    payment_id = yk_payment.get("id", "")
    payment_status = yk_payment.get("status", "pending")
    confirmation_url = (yk_payment.get("confirmation") or {}).get("confirmation_url")
    if not confirmation_url:
        raise HTTPException(502, "YooKassa не вернула ссылку на оплату")

    with session() as s:
        pay = s.get(Payment, local_payment_id)
        if pay:
            pay.operation_id = payment_id
            pay.status = payment_status or "pending"
            s.add(pay)
            s.commit()

    return {"payment_url": confirmation_url, "label": label, "payment_id": payment_id}


@app.post("/api/yookassa/notify")
async def yookassa_notify(request: Request):
    """Webhook YooKassa. Начисляет токены только после проверки платежа через API YooKassa."""
    try:
        payload = await request.json()
    except Exception:
        logger.warning("YooKassa webhook: невалидный JSON")
        return PlainTextResponse("OK", status_code=200)

    event = payload.get("event", "")
    obj = payload.get("object") or {}
    payment_id = obj.get("id", "")
    if not payment_id:
        logger.warning("YooKassa webhook без payment id: %s", payload)
        return PlainTextResponse("OK", status_code=200)

    try:
        yk_payment = await billing.get_payment(payment_id)
    except billing.YooKassaError as exc:
        logger.warning("Не удалось проверить платёж YooKassa %s: %s", payment_id, exc)
        return PlainTextResponse("retry", status_code=500)

    metadata = yk_payment.get("metadata") or obj.get("metadata") or {}
    label = metadata.get("label", "")
    status = yk_payment.get("status", "")
    paid = yk_payment.get("paid") is True

    with session() as s:
        pay = s.exec(select(Payment).where(Payment.operation_id == payment_id)).first()
        if not pay and label:
            pay = s.exec(select(Payment).where(Payment.label == label)).first()
        if not pay:
            logger.warning("YooKassa webhook: локальный платёж не найден, payment_id=%s, label=%s", payment_id, label)
            return PlainTextResponse("OK", status_code=200)

        pay.operation_id = payment_id

        if event == "payment.canceled" or status == "canceled":
            if pay.status != "paid":
                pay.status = "canceled"
                s.add(pay)
                s.commit()
            return PlainTextResponse("OK", status_code=200)

        if event != "payment.succeeded" or status != "succeeded" or not paid:
            pay.status = status or pay.status
            s.add(pay)
            s.commit()
            return PlainTextResponse("OK", status_code=200)

        try:
            actual_amount = round(float((yk_payment.get("amount") or {}).get("value", 0)), 2)
        except Exception:
            actual_amount = 0
        expected_amount = round(float(pay.rub), 2)
        if actual_amount != expected_amount:
            logger.error(
                "YooKassa webhook: сумма не совпала, payment_id=%s, actual=%s, expected=%s",
                payment_id, actual_amount, expected_amount,
            )
            return PlainTextResponse("OK", status_code=200)

        if pay.status != "paid":
            pay.status = "paid"
            pay.paid_at = datetime.utcnow()
            u = s.get(User, pay.user_id)
            if u:
                u.token_balance += pay.tokens
                s.add(u)
            s.add(pay)
            s.commit()
            logger.info("Платёж YooKassa зачтён: пользователь %s +%s токенов", pay.user_id, pay.tokens)

    return PlainTextResponse("OK", status_code=200)


# ── Раздача сайта ─────────────────────────────────────────────

@app.delete("/api/me")
def delete_account(user: User = Depends(current_user)):
    with session() as s:
        uid = user.id
        s.exec(__import__('sqlmodel').delete(Post).where(Post.user_id == uid))
        # Удаляем источники каналов пользователя
        from sqlmodel import select as sel
        chans = s.exec(sel(Channel).where(Channel.user_id == uid)).all()
        for ch in chans:
            s.exec(__import__('sqlmodel').delete(Source).where(Source.channel_id == ch.id))
        s.exec(__import__('sqlmodel').delete(Channel).where(Channel.user_id == uid))
        s.exec(__import__('sqlmodel').delete(Payment).where(Payment.user_id == uid))
        s.exec(__import__('sqlmodel').delete(Referral).where(Referral.referrer_id == uid))
        s.exec(__import__('sqlmodel').delete(Referral).where(Referral.referred_id == uid))
        u = s.get(User, uid)
        if u:
            s.delete(u)
        s.commit()
    return {"ok": True}


@app.get("/legal/offer")
def legal_offer():
    return FileResponse("static/legal/offer.html")

@app.get("/legal/privacy")
def legal_privacy():
    return FileResponse("static/legal/privacy.html")

@app.get("/legal/refund")
def legal_refund():
    return FileResponse("static/legal/refund.html")

@app.get("/")
def index():
    return FileResponse("static/index.html")


app.mount("/static", StaticFiles(directory="static"), name="static")


# ── Запуск ────────────────────────────────────────────────────

if __name__ == "__main__":
    import os
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=False)
