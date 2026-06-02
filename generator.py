"""
Генерация постов и анализ стиля через Claude API.
Поддерживает: голос, формат, эмодзи, CTA, тему поста.
"""

import re
import logging
import httpx

import config
from database import Channel

logger = logging.getLogger(__name__)
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"

VOICE_MAP = {
    "author": "от первого лица — «я», «мы», личный опыт и мнение автора",
    "news":   "сухой новостной стиль — факты без личного мнения, без «я»",
    "expert": "голос эксперта — авторитетно, с объяснением «почему», без личных историй",
}
FORMAT_MAP = {
    "story":    "история или кейс — есть начало, середина, вывод",
    "tips":     "полезные советы — конкретные шаги которые можно применить сегодня",
    "news":     "новостной пост — что случилось, почему важно, что дальше",
    "question": "пост-вопрос — подводишь к теме и задаёшь вопрос аудитории",
}
EMOJI_MAP = {
    "none":    "без эмодзи вообще",
    "minimal": "1-2 эмодзи максимум, только если очень уместны",
    "rich":    "эмодзи активно — для акцентов, заголовков, списков",
}


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
    text = text.strip()
    text = re.sub(
        r"^(Отличн\w+\s[^.!?\n]{0,80}[.!?]\s*|Пишу пост[^.!?\n]*[.!?]\s*|"
        r"Вот пост[^:]*:\s*|Готово[!.]?\s*|---\s*|Конечно[,!]?\s*)",
        "", text, flags=re.IGNORECASE
    ).strip()
    if text.startswith('"') and text.endswith('"'):
        text = text[1:-1].strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r" +\n", "\n", text)
    return text.strip()


async def _call_claude(system, user, use_web_search, max_tokens=700):
    body = {
        "model": config.ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    if use_web_search:
        body["tools"] = [{"type": "web_search_20250305", "name": "web_search", "max_uses": 2}]

    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(ANTHROPIC_URL, headers=_headers(), json=body)
        if r.status_code >= 400:
            logger.error(f"Claude API {r.status_code}: {r.text[:500]}")
            r.raise_for_status()
        data = r.json()
    return _extract_text(data), _usage_tokens(data)


async def generate_post(channel: Channel, source_material: str = "", topic: str = "") -> tuple[str, int]:
    voice = VOICE_MAP.get(getattr(channel, "post_voice", "author"), VOICE_MAP["author"])
    fmt = FORMAT_MAP.get(getattr(channel, "post_format", "story"), FORMAT_MAP["story"])
    emoji = EMOJI_MAP.get(getattr(channel, "emoji_style", "minimal"), EMOJI_MAP["minimal"])
    cta_enabled = getattr(channel, "cta_enabled", False)
    cta_text = getattr(channel, "cta_text", "") or ""

    style_block = channel.style or ""
    if channel.style_profile:
        style_block += f"\n\nПрофиль стиля:\n{channel.style_profile}"

    cta_instruction = f'\nВ КОНЦЕ добавь призыв: «{cta_text.strip()}»' if cta_enabled and cta_text.strip() else ""

    system = f"""Ты — автор Telegram-канала «{channel.title}».

О КАНАЛЕ: {channel.about}
{"СТИЛЬ: " + style_block if style_block.strip() else ""}
ЯЗЫК: {channel.language}
ДЛИНА: {channel.post_length}

НАСТРОЙКИ ПОСТА:
• Голос: {voice}
• Формат: {fmt}
• Эмодзи: {emoji}{cta_instruction}

═══ ОПРЕДЕЛИ НАСТРОЕНИЕ ПО ТЕМЕ КАНАЛА ═══

• Здоровье, болезни, потеря → БЕРЕЖНО. Без советов. Честно и тепло.
• Семья, дети → ТЕПЛО. Как разговор с близким. Читатель узнаёт себя.
• Отношения, психология → ЧЕСТНО. Конкретный приём или инсайт.
• Деньги, крипта, инвестиции → КОНКРЕТНО. Цифры, факты, вывод.
• Бизнес, карьера → КАК ИНСАЙДЕР. Реальные кейсы.
• Lifestyle, роскошь → АТМОСФЕРНО. Детали, образы, конкретный человек.
• Политика, новости → НЕЙТРАЛЬНО И ОСТРО. Факт + неочевидный угол.
• Наука, технологии → ПОНЯТНО. Сложное простыми словами.
• Саморазвитие → ВДОХНОВЛЯЮЩЕ. Конкретный шаг сегодня.

═══ СТРУКТУРА ═══
1. <b>Заголовок</b> — цепляет с первой строки
2. 2-3 абзаца с конкретикой — имя, ситуация, цифра, деталь
3. Вывод или вопрос аудитории{", призыв" if cta_enabled else ""}

═══ ПРАВИЛА ═══
- Никаких «следует отметить», «является», «в рамках» — живой язык
- Предложения разной длины
- Не «многие люди» — конкретный человек или ситуация
- Абзацы через ОДНУ пустую строку
- Тире не в начале строк как маркеры
- НЕ начинай с «Пишу пост», «Вот пост» — сразу текст
- Верни ТОЛЬКО текст поста"""

    if topic:
        user_msg = f"Напиши пост на тему: «{topic}»."
        if source_material:
            user_msg += f"\n\nИсточники:\n{source_material[:4000]}"
        elif channel.use_web_search:
            user_msg += " Найди актуальные факты."
    elif source_material:
        user_msg = "Напиши пост из этих материалов — выбери самое важное:\n\n" + source_material[:4000]
    elif channel.use_web_search:
        user_msg = "Найди свежий конкретный факт или историю по теме. Напиши пост с деталями."
    else:
        user_msg = "Напиши пост. Конкретный пример — человек, ситуация, деталь."

    do_search = channel.use_web_search and not topic
    text, tokens = await _call_claude(system, user_msg, do_search, max_tokens=650)
    return _clean_post(text), tokens


async def analyze_style(posts: list[str]) -> tuple[str, int]:
    if not posts:
        return "", 0
    sample = "\n\n---\n\n".join(posts[:15])[:7000]
    system = "Ты — редактор. Анализируешь стиль Telegram-канала чтобы другой автор мог писать неотличимо."
    user = (
        "Профиль стиля (7-9 пунктов): тон, настроение, структура поста, "
        "длина предложений, начало/конец постов, характерные приёмы, что никогда не встречается.\n\n"
        + sample
    )
    return await _call_claude(system, user, False, max_tokens=450)
