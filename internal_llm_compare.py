"""
Internal-эндпоинт сравнения качества генерации: Anthropic vs Alice AI (Yandex).

GET /api/internal/llm-compare?count=3
Authorization: Bearer {TRUEPOST_INTERNAL_API_TOKEN}

Берёт до `count` реальных каналов из БД, для каждого генерирует пост ДВАЖДЫ
(provider=anthropic и provider=yandex), ничего не публикует и не списывает
токены пользователей. Возвращает пары для сравнения глазами.

Требует настроенных YANDEX_API_KEY / YANDEX_FOLDER_ID.
"""

import os
import logging
from fastapi import APIRouter, Header, HTTPException
from sqlmodel import Session, select

import generator
from database import engine, Channel

logger = logging.getLogger(__name__)
router = APIRouter()

INTERNAL_API_TOKEN = os.environ.get("TRUEPOST_INTERNAL_API_TOKEN")


def _check_auth(authorization: str | None) -> None:
    if not INTERNAL_API_TOKEN:
        raise HTTPException(status_code=503, detail="TRUEPOST_INTERNAL_API_TOKEN not configured on this server")
    if not authorization or not authorization.startswith("Bearer ") or authorization[7:] != INTERNAL_API_TOKEN:
        raise HTTPException(status_code=401, detail="invalid internal token")


@router.get("/api/internal/llm-compare")
async def llm_compare(count: int = 3, authorization: str | None = Header(default=None)):
    _check_auth(authorization)
    with Session(engine) as s:
        channels = s.exec(select(Channel).limit(max(1, min(count, 5)))).all()
    if not channels:
        return {"error": "нет каналов в БД для теста"}

    pairs = []
    for ch in channels:
        item = {"channel": ch.title, "about": (ch.about or "")[:200]}
        for provider in ("anthropic", "yandex"):
            generator.FORCE_PROVIDER = provider
            try:
                # тематическая генерация без поиска — одинаковые условия
                text, tokens = await generator.generate_post(ch, topic="")
                item[provider] = {"post": text, "tokens": tokens}
            except Exception as e:
                item[provider] = {"error": str(e)[:300]}
            finally:
                generator.FORCE_PROVIDER = None
        pairs.append(item)

    return {"provider_config": {"yandex_model": bool(os.getenv("YANDEX_MODEL_URI") or os.getenv("YANDEX_FOLDER_ID"))},
            "pairs": pairs}
