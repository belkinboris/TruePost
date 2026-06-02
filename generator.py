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
    return int(u.get("input_tokens", 0)) + int(u.get("output_tokens", 0))


def _clean_post(text: str) -> str:
    """Убираем мусор который Claude иногда добавляет перед постом."""
    text = text.strip()
    # Убираем вступления типа "Пишу пост...", "Отличные данные...", "Вот пост:"
    trash_patterns = [
        r"^(Отличные данные\.?|Пишу пост[^.]*\.|Вот пост:|Готово!|Конечно[,!]?)[^\n]*\n+",
        r"^---\n+",
    ]
    for p in trash_patterns:
        text = re.sub(p, "", text, flags=re.IGNORECASE).strip()
    # Убираем обёртку в кавычки
    if text.startswith('"') and text.endswith('"'):
        text = text[1:-1].strip()
    # Схлопываем тройные+ переносы строк в двойные
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Убираем пробелы перед переносом строки
    text = re.sub(r" +\n", "\n", text)
    return text.strip()


async def _call_claude(
    system: str, user: str, use_web_search: bool, max_tokens: int = 800
) -> tuple[str, int]:
    body = {
        "model": config.ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    if use_web_search:
        # max_uses=2 вместо 5 — экономим токены
        body["tools"] = [{"type": "web_search_20250305", "name": "web_search", "max_uses": 2}]

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
    style_block = channel.style or "живо, по делу, без воды"
    if channel.style_profile:
        style_block += f"\n\nПрофиль стиля канала:\n{channel.style_profile}"

    system = f"""Ты — автор Telegram-канала «{channel.title}».

О КАНАЛЕ: {channel.about}
СТИЛЬ: {style_block}
ЯЗЫК: {channel.language}
ДЛИНА: {channel.post_length}

ГЛАВНОЕ ПРАВИЛО — ЖАНР:
Внимательно прочитай описание канала и определи жанр поста:
- Если канал про людей, образ жизни, истории — пиши как живую историю про конкретного человека или момент. Читатель должен почувствовать этот мир изнутри.
- Если канал про новости, аналитику — пиши чётко, фактурно, без воды.
- Если про бизнес, сделки — пиши как инсайдер, который знает детали.
Никогда не подменяй жанр: lifestyle-канал не должен превращаться в аналитический отчёт.

СТРОГИЕ ЗАПРЕТЫ:
- НЕ пиши вступлений типа «Пишу пост», «Отличные данные», «Вот пост:» — сразу текст
- НЕ используй тире в начале строк (— вот так — запрещено)
- НЕ делай двойные пустые строки между абзацами — только одна пустая строка
- НЕ пиши как аналитический доклад или новостная статья если канал про стиль жизни
- НЕ используй слова: «волатильность», «ликвидность», «family office», «кондоминиум» в lifestyle-канале
- Без хэштегов (если стиль не требует)
- Верни ТОЛЬКО текст поста, ничего больше"""

    user = "Напиши один пост для канала."

    if source_material:
        user += (
            "\n\nИспользуй эти материалы как источник фактов — "
            "выбери самое интересное, но пиши в жанре канала, не пересказывай источник:\n\n"
            + source_material[:6000]  # было 12000 — режем вдвое
        )
    elif channel.use_web_search:
        user += " Найди один свежий и конкретный факт или историю по теме канала и напиши пост."
    else:
        user += " Напиши пост по теме канала."

    text, tokens = await _call_claude(system, user, channel.use_web_search, max_tokens=600)
    return _clean_post(text), tokens


# ── АНАЛИЗ СТИЛЯ ЧУЖОГО КАНАЛА ───────────────────────────────

async def analyze_style(posts: list[str]) -> tuple[str, int]:
    """
    По набору постов выводит компактный профиль стиля.
    """
    if not posts:
        return "", 0

    sample = "\n\n---\n\n".join(posts[:15])[:8000]  # было 20 постов / 12000 символов
    system = (
        "Ты — аналитик контента. По примерам постов опиши стиль коротко и точно — "
        "чтобы другой автор сразу понял как писать."
    )
    user = (
        "Составь профиль стиля канала (6–8 пунктов): тон, длина, структура, "
        "форматирование, с чего начинаются посты, чем заканчиваются. "
        "Только профиль — кратко, без примеров.\n\n" + sample
    )
    return await _call_claude(system, user, use_web_search=False, max_tokens=400)
