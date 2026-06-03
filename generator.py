"""
Генерация постов и анализ стиля через Claude API.
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

# Строки-монологи Claude которые не должны попасть в пост
_TRASH_PATTERNS = [
    r"Отличн\w+.{0,100}",
    r"Пишу пост.*",
    r"Вот пост.*",
    r"Готово[!.]?",
    r"Конечно[,!\s].*",
    r"Дай мне.*",
    r"Сейчас.{0,40}",
    r"Есть всё.*",
    r"Нашёл.*",
    r"Ищу.*",
    r"Смотрю.*",
    r"Тема:\s*.*",
    r"[-\u2014\u2013]{1,3}",   # одиночные тире как разделители
]
_TRASH_RE = re.compile(
    r"^(" + "|".join(_TRASH_PATTERNS) + r")\s*$",
    re.IGNORECASE
)


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
    """Убирает строки-монологи Claude с начала поста."""
    text = text.strip()

    post_lines = text.split("\n")
    # Удаляем мусорные строки и пустые строки с начала
    while post_lines and (
        not post_lines[0].strip()
        or _TRASH_RE.match(post_lines[0].strip())
    ):
        post_lines.pop(0)

    text = "\n".join(post_lines).strip()

    # Убираем кавычки-обёртку
    if text.startswith('"') and text.endswith('"'):
        text = text[1:-1].strip()

    # Схлопываем тройные переносы
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r" +\n", "\n", text)
    return text.strip()


async def _call_claude(
    system: str, user: str, use_web_search: bool, max_tokens: int = 700
) -> tuple[str, int]:
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
    """Создаёт один пост для канала."""
    voice = VOICE_MAP.get(getattr(channel, "post_voice", "author"), VOICE_MAP["author"])
    fmt = FORMAT_MAP.get(getattr(channel, "post_format", "story"), FORMAT_MAP["story"])
    emoji = EMOJI_MAP.get(getattr(channel, "emoji_style", "minimal"), EMOJI_MAP["minimal"])
    cta_enabled = getattr(channel, "cta_enabled", False)
    cta_text = getattr(channel, "cta_text", "") or ""

    style_block = channel.style or ""
    if channel.style_profile:
        style_block += f"\n\nПрофиль стиля:\n{channel.style_profile}"

    cta_instruction = f'\nВ КОНЦЕ добавь призыв: «{cta_text.strip()}»' if cta_enabled and cta_text.strip() else ""

    # Определяем жанр по теме — это главное
    about_lower = (channel.about or "").lower()
    style_lower = (channel.style or "").lower()
    combined = about_lower + " " + style_lower

    # Юмор/абсурд/мемы — особый режим, перекрывает всё
    is_humor = any(w in combined for w in [
        "смешн", "юмор", "абсурд", "мем", "прикол", "зумер", "дебил",
        "весел", "ирони", "сатир", "угар", "ржать", "ржака", "шутк",
        "хохот", "комедия", "fun", "humor", "meme", "joke"
    ])

    if is_humor:
        mood_instruction = """
ЭТО ЮМОРИСТИЧЕСКИЙ КАНАЛ. Это важнее всего остального.

Пиши как зумер в интернете — коротко, дерзко, с абсурдом и неожиданными поворотами.
Стиль: строчные буквы, обрывистые фразы, внезапная смена темпа, эмодзи как реакция (💀🙏😭).
Структура: ситуация → абсурдный твист → тупиковый вывод ИЛИ просто наблюдение которое смешно само по себе.
Никакой морали. Никакого «и вот я понял». Никаких выводов о жизни.
Длина — короткая. Смешное не объясняют.
НЕ ИСПОЛЬЗОВАТЬ: жирный заголовок, длинные абзацы, поучительный финал."""
    else:
        mood_instruction = f"""
ОПРЕДЕЛИ НАСТРОЕНИЕ ПО ТЕМЕ:
• Здоровье, болезни, потеря → БЕРЕЖНО. Без советов. Честно и тепло.
• Семья, дети → ТЕПЛО. Как разговор с близким.
• Отношения, психология → ЧЕСТНО. Конкретный приём или инсайт.
• Деньги, крипта, инвестиции → КОНКРЕТНО. Цифры, факты, вывод.
• Бизнес, карьера → КАК ИНСАЙДЕР. Реальные кейсы.
• Lifestyle, роскошь → АТМОСФЕРНО. Детали, образы, конкретный человек.
• Политика, новости → НЕЙТРАЛЬНО И ОСТРО. Факт + неочевидный угол.
• Наука, технологии → ПОНЯТНО. Сложное простыми словами.
• Саморазвитие → ВДОХНОВЛЯЮЩЕ. Конкретный шаг сегодня.

СТРУКТУРА:
1. <b>Заголовок</b> — цепляет с первой строки
2. 2-3 абзаца с конкретикой — имя, ситуация, деталь
3. Вывод или вопрос{", призыв" if cta_enabled else ""}"""

    system = f"""Ты — автор Telegram-канала «{channel.title}».

О КАНАЛЕ: {channel.about}
{"СТИЛЬ АВТОРА: " + style_block if style_block.strip() else ""}
ЯЗЫК: {channel.language}
ДЛИНА: {channel.post_length}
{f"Голос: {voice}" if not is_humor else ""}
{f"Формат: {fmt}" if not is_humor else ""}
Эмодзи: {emoji}
{cta_instruction}
{mood_instruction}

ПРАВИЛА ДЛЯ ВСЕХ:
- Никаких «следует отметить», «является», «в рамках» — живой язык
- НЕ начинай с «Пишу пост», «Вот пост», «Дай мне секунду», «Нашёл» — сразу текст
- ЗАПРЕЩЕНО: вступления, монологи, комментарии до текста поста
- ЗАПРЕЩЕНО: спрашивать уточнения, предлагать варианты тем, писать меню
- Если тема не задана — выбери сам и пиши
- Верни ТОЛЬКО готовый текст поста, ничего больше"""

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
