"""
PostBot — основное приложение FastAPI.
Запускает API + раздаёт сайт (папка static) + планировщик.
Один сервис на Railway.
"""

import json
import logging
import secrets
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
import scheduler
import tasks
from database import (
    init_db, session,
    User, Channel, Source, Post, Payment,
)
from schemas import (
    AuthIn, ChannelIn, ChannelPatch, SourceIn,
    AnalyzeIn, PostPatch, ScheduleIn, BuyIn,
)

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("postbot")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("БД готова")
    scheduler.start()
    yield
    scheduler.stop()


app = FastAPI(title="PostBot", lifespan=lifespan)


# ── АВТОРИЗАЦИЯ ───────────────────────────────────────────────

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
        # вернём «отвязанный» объект
        s.expunge(user)
        return user


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


# ── МЕТА / КОНФИГ ─────────────────────────────────────────────

@app.get("/api/config")
def get_config():
    return {
        "bot_username": config.TELEGRAM_BOT_USERNAME,
        "public_url": config.PUBLIC_URL,
        "packages": config.TOKEN_PACKAGES,
        "yoomoney_enabled": bool(config.YOOMONEY_WALLET),
    }


# ── РЕГИСТРАЦИЯ / ВХОД ────────────────────────────────────────

@app.post("/api/register")
def register(data: AuthIn):
    email = data.email.strip().lower()
    if "@" not in email or len(data.password) < 6:
        raise HTTPException(400, "Нужен корректный email и пароль от 6 символов")
    with session() as s:
        if s.exec(select(User).where(User.email == email)).first():
            raise HTTPException(400, "Пользователь с таким email уже есть")
        user = User(
            email=email,
            password_hash=security.hash_password(data.password),
            token_balance=config.WELCOME_TOKENS,
        )
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
    return {
        "email": user.email,
        "token_balance": user.token_balance,
        "is_admin": user.is_admin,
    }


# ── КАНАЛЫ ────────────────────────────────────────────────────

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
            post_length=data.post_length,
            language=data.language,
            use_web_search=data.use_web_search,
            auto_publish=data.auto_publish,
            schedule_kind=data.schedule_kind,
            interval_hours=data.interval_hours,
            daily_times=json.dumps(data.daily_times),
            enabled=data.enabled,
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
            ch.verified = False  # изменили канал — нужно проверить заново
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
        raise HTTPException(400, "Сначала укажите @username или ID канала")
    ok, message = await telegram_api.verify_channel(chat)
    with session() as s:
        ch = _own_channel(s, channel_id, user)
        ch.verified = ok
        s.add(ch)
        s.commit()
    return {"ok": ok, "message": message}


@app.post("/api/channels/{channel_id}/generate")
async def generate_channel(channel_id: int, user: User = Depends(current_user)):
    with session() as s:
        _own_channel(s, channel_id, user)
    result = await tasks.generate_for_channel(channel_id)
    if not result["ok"]:
        raise HTTPException(400, result["message"])
    return result


@app.post("/api/channels/{channel_id}/analyze")
async def analyze_channel(channel_id: int, data: AnalyzeIn, user: User = Depends(current_user)):
    """Читает чужой публичный канал и выводит профиль стиля."""
    with session() as s:
        ch = _own_channel(s, channel_id, user)
        if user.token_balance <= 0:
            raise HTTPException(400, "Закончились токены")

    posts = await research.scrape_channel(data.link)
    if not posts:
        raise HTTPException(400, "Не удалось прочитать канал. Он должен быть публичным (открытым).")

    profile, tokens = await generator.analyze_style(posts)

    with session() as s:
        ch = s.get(Channel, channel_id)
        ch.style_profile = profile
        u = s.get(User, user.id)
        u.token_balance = max(0, u.token_balance - tokens)
        s.add(ch)
        s.add(u)
        s.commit()
    return {"ok": True, "profile": profile, "analyzed_posts": len(posts), "tokens_used": tokens}


# ── ИСТОЧНИКИ ─────────────────────────────────────────────────

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
        s.add(src)
        s.commit()
        s.refresh(src)
        return src.model_dump()


@app.delete("/api/sources/{source_id}")
def delete_source(source_id: int, user: User = Depends(current_user)):
    with session() as s:
        src = s.get(Source, source_id)
        if not src:
            raise HTTPException(404, "Источник не найден")
        _own_channel(s, src.channel_id, user)
        s.delete(src)
        s.commit()
    return {"ok": True}


# ── ПОСТЫ ─────────────────────────────────────────────────────

@app.get("/api/channels/{channel_id}/posts")
def list_posts(channel_id: int, user: User = Depends(current_user)):
    with session() as s:
        _own_channel(s, channel_id, user)
        posts = s.exec(
            select(Post).where(Post.channel_id == channel_id).order_by(Post.created_at.desc())
        ).all()
        return [p.model_dump() for p in posts]


@app.get("/api/posts/{post_id}")
def get_post(post_id: int, user: User = Depends(current_user)):
    with session() as s:
        return _own_post(s, post_id, user).model_dump()


@app.patch("/api/posts/{post_id}")
def edit_post(post_id: int, data: PostPatch, user: User = Depends(current_user)):
    with session() as s:
        p = _own_post(s, post_id, user)
        if p.status == "published":
            raise HTTPException(400, "Опубликованный пост нельзя редактировать здесь")
        p.text = data.text
        s.add(p)
        s.commit()
        s.refresh(p)
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
        s.add(p)
        s.commit()
        s.refresh(p)
        return p.model_dump()


@app.post("/api/posts/{post_id}/reject")
def reject_post(post_id: int, user: User = Depends(current_user)):
    with session() as s:
        p = _own_post(s, post_id, user)
        p.status = "rejected"
        s.add(p)
        s.commit()
    return {"ok": True}


@app.delete("/api/posts/{post_id}")
def delete_post(post_id: int, user: User = Depends(current_user)):
    with session() as s:
        p = _own_post(s, post_id, user)
        s.delete(p)
        s.commit()
    return {"ok": True}


# ── БИЛЛИНГ ───────────────────────────────────────────────────

@app.get("/api/packages")
def packages():
    return config.TOKEN_PACKAGES


@app.get("/api/payments")
def payments(user: User = Depends(current_user)):
    with session() as s:
        ps = s.exec(
            select(Payment).where(Payment.user_id == user.id).order_by(Payment.created_at.desc())
        ).all()
        return [p.model_dump() for p in ps]


@app.post("/api/billing/buy")
def buy(data: BuyIn, user: User = Depends(current_user)):
    pkg = config.package_by_id(data.package_id)
    if not pkg:
        raise HTTPException(400, "Пакет не найден")
    if not config.YOOMONEY_WALLET:
        raise HTTPException(400, "Приём платежей не настроен (нет кошелька ЮMoney)")

    label = f"u{user.id}-{data.package_id}-{secrets.token_hex(6)}"
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

    url = billing.build_payment_url(
        label=label,
        amount_rub=pkg["rub"],
        description=f"PostBot: пакет «{pkg['title']}» ({pkg['tokens']} токенов)",
    )
    return {"payment_url": url, "label": label}


@app.post("/api/yoomoney/notify")
async def yoomoney_notify(request: Request):
    """HTTP-уведомление от ЮMoney о поступившем платеже."""
    form = dict((await request.form()))
    if not billing.verify_notification(form):
        # Возвращаем 200, чтобы ЮMoney не долбила повторами, но токены не начисляем
        return PlainTextResponse("bad signature", status_code=200)

    label = form.get("label", "")
    with session() as s:
        pay = s.exec(select(Payment).where(Payment.label == label)).first()
        if not pay:
            logger.warning(f"Платёж с меткой {label} не найден")
            return PlainTextResponse("OK", status_code=200)
        if pay.status == "paid":
            return PlainTextResponse("OK", status_code=200)  # уже начислено

        pay.status = "paid"
        pay.operation_id = form.get("operation_id", "")
        pay.paid_at = datetime.utcnow()

        user = s.get(User, pay.user_id)
        if user:
            user.token_balance += pay.tokens
            s.add(user)
        s.add(pay)
        s.commit()
        logger.info(f"Платёж зачтён: пользователь {pay.user_id} +{pay.tokens} токенов")

    return PlainTextResponse("OK", status_code=200)


# ── РАЗДАЧА САЙТА ─────────────────────────────────────────────
# Структура на GitHub:
#   static/index.html  — подключает /static/styles.css и /static/app.js
#   static/styles.css
#   static/app.js
# FastAPI раздаёт папку static/ по префиксу /static/
# и отдаёт index.html на корневой запрос.

@app.get("/")
def index():
    return FileResponse("static/index.html")

app.mount("/static", StaticFiles(directory="static"), name="static")


# ── ЗАПУСК ────────────────────────────────────────────────────

if __name__ == "__main__":
    import os
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=False)
