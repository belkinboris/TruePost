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

_TRASH_PATTERNS = [
    r"Отличн\w+.{0,100}", r"Пишу пост.*", r"Вот пост.*", r"Готово[!.]?",
    r"Конечно[,!\s].*", r"Дай мне.*", r"Сейчас.{0,40}", r"Есть всё.*",
    r"Нашёл.*", r"Ищу.*", r"Смотрю.*", r"Тема:\s*.*", r"[-\u2014\u2013]{1,3}",
    # Thinking-блоки Claude при web_search
    r"Беру.{0,80}(сделк|новост|факт|пост|поиск).*",
    r"Взял.{0,80}(сделк|новост|факт|пост|поиск).*",
    r"Нашёл.{0,80}(сделк|новост|факт|пост|поиск).*",
    r"Выбрал.{0,80}(сделк|новост|факт|пост|тему).*",
    r"Использую.{0,80}",
    r"Из поиска.{0,80}",
    r"По результатам.{0,80}",
    r"Проверил.{0,80}",
    r"Вижу.{0,80}(сделк|новост|факт).*",
]
_TRASH_RE = re.compile(r"^(" + "|".join(_TRASH_PATTERNS) + r")\s*$", re.IGNORECASE)

# Паттерн для определения thinking-блока: абзац до "---" или до пустой строки
# который выглядит как рассуждение а не пост
_THINKING_RE = re.compile(
    r"^(Беру|Взял|Нашёл|Выбрал|Использую|Из поиска|По результатам|Проверил|Вижу|Смотрю|Ищу|Изучил|Анализирую).+",
    re.IGNORECASE | re.DOTALL
)


def _headers() -> dict:
    return {
        "x-api-key": config.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }


def _extract_text(data: dict) -> str:
    return "\n".join(b["text"] for b in data.get("content", []) if b.get("type") == "text").strip()


def _usage_tokens(data: dict) -> int:
    u = data.get("usage", {})
    return int(u.get("input_tokens", 0)) + int(u.get("output_tokens", 0))


def _clean_post(text: str) -> str:
    text = text.strip()

    # Режем всё до разделителя --- если он есть
    if "\n---\n" in text:
        text = text.split("\n---\n", 1)[1].strip()
    elif "\n---" in text and text.index("\n---") < 300:
        text = text.split("\n---", 1)[1].strip()

    lines = text.split("\n")

    # Убираем мусорные строки в начале
    while lines and (not lines[0].strip() or _TRASH_RE.match(lines[0].strip())):
        lines.pop(0)

    # Если первый абзац — thinking-блок (до первой пустой строки), убираем его
    if lines:
        first_para_lines = []
        for i, line in enumerate(lines):
            if not line.strip():
                break
            first_para_lines.append(line)
        first_para = " ".join(first_para_lines)
        if _THINKING_RE.match(first_para.strip()):
            # Пропускаем первый абзац и пустые строки после него
            rest = lines[len(first_para_lines):]
            while rest and not rest[0].strip():
                rest.pop(0)
            if rest:  # только если есть что-то после
                lines = rest

    text = "\n".join(lines).strip()
    if text.startswith('"') and text.endswith('"'):
        text = text[1:-1].strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


import asyncio

class GenerationError(Exception):
    """Понятная ошибка генерации для показа пользователю."""
    pass

async def _call_claude(system, user, use_web_search, max_tokens=700):
    body = {
        "model": config.ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    if use_web_search:
        body["tools"] = [{"type": "web_search_20250305", "name": "web_search", "max_uses": 2}]

    last_error = None
    for attempt in range(3):  # до 3 попыток на перегрузку
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                r = await client.post(ANTHROPIC_URL, headers=_headers(), json=body)
        except httpx.TimeoutException:
            last_error = "timeout"
            await asyncio.sleep(2 * (attempt + 1))
            continue

        if r.status_code < 400:
            data = r.json()
            return _extract_text(data), _usage_tokens(data)

        # Ошибки
        logger.error(f"Claude API {r.status_code}: {r.text[:500]}")
        if r.status_code in (429, 529):  # rate limit / overloaded
            last_error = "overloaded"
            await asyncio.sleep(3 * (attempt + 1))
            continue
        if r.status_code == 401:
            raise GenerationError("Ошибка авторизации ИИ. Обратитесь в поддержку.")
        if r.status_code == 400:
            raise GenerationError("Не удалось сгенерировать пост. Попробуйте изменить тему.")
        # Прочие ошибки — последняя попытка
        last_error = f"http_{r.status_code}"
        await asyncio.sleep(2)

    # Все попытки исчерпаны
    if last_error == "overloaded":
        raise GenerationError("Серверы ИИ сейчас перегружены. Попробуйте через минуту.")
    if last_error == "timeout":
        raise GenerationError("Превышено время ожидания. Попробуйте ещё раз.")
    raise GenerationError("Временная ошибка ИИ. Попробуйте ещё раз через минуту.")


async def generate_post(channel: Channel, source_material: str = "", topic: str = "", custom_rules: str = "", recent_titles: str = "") -> tuple[str, int]:
    voice = VOICE_MAP.get(getattr(channel, "post_voice", "author"), VOICE_MAP["author"])
    fmt = FORMAT_MAP.get(getattr(channel, "post_format", "story"), FORMAT_MAP["story"])
    emoji = EMOJI_MAP.get(getattr(channel, "emoji_style", "minimal"), EMOJI_MAP["minimal"])
    cta_enabled = getattr(channel, "cta_enabled", False)
    cta_text = getattr(channel, "cta_text", "") or ""

    style_block = channel.style or ""
    if channel.style_profile:
        style_block += f"\n\nПрофиль стиля:\n{channel.style_profile}"

    cta_instruction = f'\nВ КОНЦЕ добавь призыв: «{cta_text.strip()}»' if cta_enabled and cta_text.strip() else ""

    rules_block = f"\n\nПЕРСОНАЛЬНЫЕ ПРАВИЛА (обязательно соблюдать):\n{custom_rules}" if custom_rules else ""

    about_lower = (channel.about or "").lower()
    style_lower = (channel.style or "").lower()
    combined = about_lower + " " + style_lower

    is_humor = any(w in combined for w in [
        "смешн", "юмор", "абсурд", "мем", "прикол", "зумер", "дебил",
        "весел", "ирони", "сатир", "угар", "ржать", "ржака", "шутк", "хохот",
    ])

    if is_humor:
        mood_instruction = """
ЭТО ЮМОРИСТИЧЕСКИЙ КАНАЛ.
Пиши как зумер в интернете — коротко, дерзко, абсурд и неожиданные повороты.
Строчные буквы, обрывистые фразы, эмодзи как реакция (💀🙏😭).
Никакой морали. Никаких выводов о жизни. Длина — короткая."""
    else:
        mood_instruction = f"""
ОПРЕДЕЛИ НАСТРОЕНИЕ ПО ТЕМЕ:
• Здоровье, болезни → БЕРЕЖНО. Без советов. Честно и тепло.
• Семья, дети → ТЕПЛО. Как разговор с близким.
• Отношения, психология → ЧЕСТНО. Конкретный приём.
• Деньги, крипта → КОНКРЕТНО. Цифры, факты, вывод.
• Бизнес, карьера → КАК ИНСАЙДЕР. Реальные кейсы.
• Lifestyle, роскошь → АТМОСФЕРНО. Детали, образы, конкретный человек.
• Политика, новости → НЕЙТРАЛЬНО И ОСТРО. Факт + неочевидный угол.
• Саморазвитие → ВДОХНОВЛЯЮЩЕ. Конкретный шаг сегодня.

СТРУКТУРА:
1. <b>Заголовок</b> — цепляет с первой строки
2. 2-3 абзаца с конкретикой — имя, ситуация, деталь
3. Вывод или вопрос{", призыв" if cta_enabled else ""}"""

    system = f"""Ты — автор Telegram-канала «{channel.title}».

О КАНАЛЕ: {channel.about}
{"СТИЛЬ: " + style_block if style_block.strip() else ""}
ЯЗЫК: {channel.language}
ДЛИНА: {channel.post_length}
Голос: {voice if not is_humor else "зумерский"}
Формат: {fmt if not is_humor else "короткий абсурд"}
Эмодзи: {emoji}
{cta_instruction}
{rules_block}
{mood_instruction}

{f'''УЖЕ ОПУБЛИКОВАНО — не повторять:
{recent_titles}
Правило: выбирай НОВОЕ событие которого нет в списке.
Если все свежие события уже покрыты — возьми другой угол: последствия, реакция рынка, сравнение с похожим случаем. Никогда не пиши про то же событие теми же словами.

''' if recent_titles else ""}БАЗОВЫЕ ПРАВИЛА (нарушение недопустимо):
- Длинное тире — ЗАПРЕЩЕНО. Используй только короткое тире -
- ЗАПРЕЩЕНО любое вступление, объяснение или рассуждение перед постом
- ЗАПРЕЩЕНЫ фразы-действия: «Беру сделку», «Взял новость», «Нашёл факт», «Из поиска», «Выбрал тему», «Использую», «Проверил» — и любые похожие
- ЗАПРЕЩЕНО отделять рассуждения от поста символами ---, ***, или пустыми строками
- Первая строка ответа = первая строка поста. Ноль слов до поста
- Никаких «следует отметить», «является», «в рамках»
- ЗАПРЕЩЕНО спрашивать уточнения — пиши сам
- Абзацы через ОДНУ пустую строку
- Верни ТОЛЬКО текст поста. Никаких комментариев ни до ни после"""

    use_search = channel.use_web_search and not topic
    if topic:
        user_msg = f"Напиши пост на тему: «{topic}»."
        if source_material:
            user_msg += f"\n\nИсточники:\n{source_material[:4000]}"
        elif channel.use_web_search:
            user_msg += " Найди актуальные факты."
    elif source_material:
        user_msg = "Напиши пост из этих материалов:\n\n" + source_material[:4000]
    elif channel.use_web_search:
        user_msg = "Найди свежий конкретный факт по теме. Напиши пост с деталями. Используй только актуальные данные из поиска, не из памяти."
    else:
        user_msg = "Напиши пост. Конкретный пример — человек, ситуация, деталь."

    text, tokens = await _call_claude(system, user_msg, use_search, max_tokens=650)
    return _clean_post(text), tokens


async def check_news_available(channel: "Channel") -> tuple:
    """Проверяет есть ли свежие новости по теме. Возвращает (bool, tokens_used)."""
    system = "You are a news editor. Reply only YES or NO."
    user = (
        f"Topic: {channel.about}\n\n"
        f"Are there any NEW events or news on this topic in the last 24 hours worth covering? "
        f"Answer with one word: YES or NO."
    )
    body = {
        "model": config.ANTHROPIC_MODEL,
        "max_tokens": 10,
        "system": system,
        "messages": [{"role": "user", "content": user}],
        "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": 1}],
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(ANTHROPIC_URL, headers=_headers(), json=body)
        data = r.json()
    text = _extract_text(data).strip().upper()
    tokens = _usage_tokens(data)
    has_news = "YES" in text
    return has_news, tokens


async def consult(channel: "Channel", user_message: str, history: list, rules_text: str = "") -> tuple:
    """
    ИИ-консультант для настройки стиля.
    Возвращает (ответ, suggested_rule или None).
    """
    msg_count = len([h for h in history if h.get("role") == "user"])
    system = f"""Ты — помощник по настройке стиля Telegram-канала «{channel.title}».

О канале: {channel.about}
Текущие правила: {rules_text or "нет"}

ПРАВИЛА ДИАЛОГА:
— Задавай ТОЛЬКО ОДИН короткий вопрос за раз. Никаких списков вариантов.
— Пиши коротко — 1-3 предложения максимум.
— Никакого Markdown: не используй **, *, #, ---
— Для выделения жирным используй HTML-теги Telegram: <b>текст</b>
— Примеры правил могут включать форматирование через <b></b> — это нормально
— Разговорный стиль — как живой человек, не как ассистент.
— Когда понял конкретное требование, сразу предложи правило.
— В конце ответа, если есть конкретное правило, добавь: ПРАВИЛО: [текст правила]

Примеры правил:
ПРАВИЛО: Не использовать длинное тире, только короткое
ПРАВИЛО: Писать только про события 2025-2026 года
ПРАВИЛО: Каждый пост начинать с цифры или конкретного имени

Это сообщение {msg_count + 1} в диалоге. Будь конкретен и краток."""

    messages = []
    for h in history[-6:]:  # последние 6 сообщений
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": user_message})

    body = {
        "model": config.ANTHROPIC_MODEL,
        "max_tokens": 500,
        "system": system,
        "messages": messages,
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(ANTHROPIC_URL, headers=_headers(), json=body)
        data = r.json()

    response = _extract_text(data)

    # Извлекаем правило если есть
    rule = None
    rule_match = re.search(r"ПРАВИЛО:\s*(.+?)(?:\n|$)", response)
    if rule_match:
        rule = rule_match.group(1).strip()
        response = response[:rule_match.start()].strip()

    return response, rule


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
