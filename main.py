"""
Генерация постов и анализ стиля через Claude API.
Возвращает текст + количество использованных токенов (для биллинга).
"""

import re
import logging
import httpx

import config
from database import Channel

logger = logging.getLogger(__name__)

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"


def _headers() -> dict:
    return {
        "x-api-key": config.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }


def _extract_text(data: dict) -> str:
    parts = []
    for block in data.get("content", []):
        if block.get("type") == "text":
            parts.append(block["text"])
    return "\n".join(parts).strip()


def _usage_tokens(data: dict) -> int:
    u = data.get("usage", {})
    total = int(u.get("input_tokens", 0)) + int(u.get("output_tokens", 0))
    return total


async def _call_claude(system: str, user: str, use_web_search: bool, max_tokens: int = 1500) -> tuple[str, int]:
    body = {
        "model": config.ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    if use_web_search:
        body["tools"] = [{"type": "web_search_20250305", "name": "web_search", "max_uses": 5}]

    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(ANTHROPIC_URL, headers=_headers(), json=body)
        if r.status_code >= 400:
            logger.error(f"Claude API {r.status_code}: {r.text[:500]}")
            r.raise_for_status()
        data = r.json()

    return _extract_text(data), _usage_tokens(data)


# ── ГЕНЕРАЦИЯ ПОСТА ──────────────────────────────────────────

async def generate_post(channel: Channel, source_material: str = "") -> tuple[str, int]:
    """
    Создаёт один пост для канала.
    Возвращает (текст_поста, использовано_токенов).
    """
    style_block = channel.style or "Информативно, по делу, профессионально."
    if channel.style_profile:
        style_block += f"\n\nПрофиль стиля (выведен из примеров постов канала):\n{channel.style_profile}"

    system = f"""Ты — главный редактор Telegram-канала. Пишешь готовые к публикации посты.

КАНАЛ: {channel.title}
ТЕМАТИКА: {channel.about}
СТИЛЬ: {style_block}
ЯЗЫК: {channel.language}
ДЛИНА: {channel.post_length}

ПРАВИЛА:
- Верни ТОЛЬКО текст поста, без пояснений, без вариантов, без кавычек вокруг.
- Не выдумывай факты. Если используешь данные из источников — опирайся на них.
- Telegram поддерживает HTML: <b>жирный</b>, <i>курсив</i>, <a href="">ссылки</a>. Используй умеренно.
- Без хэштегов, если стиль не требует.
- Пиши живым языком, не канцелярит."""

    user = "Напиши новый пост для канала."
    if source_material:
        user += (
            "\n\nВот свежий материал из заданных источников — используй актуальные факты отсюда, "
            "выбери самое важное и интересное для подписчиков:\n\n" + source_material[:12000]
        )
    else:
        user += " Найди свежую и релевантную информацию по тематике канала."

    text, tokens = await _call_claude(system, user, channel.use_web_search)

    # Чистим возможные обёртки-кавычки
    text = text.strip()
    if text.startswith('"') and text.endswith('"') and text.count('"') == 2:
        text = text[1:-1].strip()
    return text, tokens


# ── АНАЛИЗ СТИЛЯ ЧУЖОГО КАНАЛА ───────────────────────────────

async def analyze_style(posts: list[str]) -> tuple[str, int]:
    """
    По набору постов выводит компактный «профиль стиля»,
    который потом подмешивается в генерацию.
    """
    if not posts:
        return "", 0

    sample = "\n\n---\n\n".join(posts[:20])[:12000]
    system = (
        "Ты — аналитик контента. По примерам постов канала опиши его стиль так, "
        "чтобы другой автор смог писать неотличимо похоже."
    )
    user = (
        "Проанализируй посты ниже и составь профиль стиля (8–12 пунктов): тон, длина, "
        "структура, форматирование, эмодзи, типичные обороты, как начинаются и заканчиваются посты, "
        "обращение к аудитории. Только профиль, без пересказа постов.\n\n" + sample
    )
    return await _call_claude(system, user, use_web_search=False, max_tokens=900)
