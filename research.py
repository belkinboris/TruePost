"""
Сбор материала для постов:
  - fetch_sources: качает страницы/RSS, которые пользователь задал как источники
  - scrape_channel: читает посты публичного телеграм-канала через web-превью t.me/s/<name>
"""

import re
import logging
import httpx

logger = logging.getLogger(__name__)

_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_RE = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.DOTALL | re.IGNORECASE)
_WS_RE = re.compile(r"\n\s*\n+")


def _html_to_text(html: str, limit: int = 4000) -> str:
    html = _SCRIPT_RE.sub(" ", html)
    text = _TAG_RE.sub(" ", html)
    text = re.sub(r"&[a-z]+;", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = _WS_RE.sub("\n", text)
    return text.strip()[:limit]


async def fetch_sources(urls: list[str], per_source_limit: int = 3000) -> str:
    """Качает все источники, возвращает один склеенный текст для передачи Claude."""
    if not urls:
        return ""

    chunks = []
    async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers={
        "User-Agent": "Mozilla/5.0 (compatible; PostBot/1.0)"
    }) as client:
        for url in urls:
            try:
                r = await client.get(url)
                content_type = r.headers.get("content-type", "")
                raw = r.text
                # RSS/XML отдаём как есть (обрезаем), HTML — чистим
                if "xml" in content_type or url.endswith((".rss", ".xml")) or "<rss" in raw[:200]:
                    text = re.sub(r"[ \t]+", " ", raw)[:per_source_limit]
                else:
                    text = _html_to_text(raw, per_source_limit)
                chunks.append(f"=== ИСТОЧНИК: {url} ===\n{text}")
            except Exception as e:
                logger.warning(f"Не удалось получить источник {url}: {e}")
                chunks.append(f"=== ИСТОЧНИК: {url} === (недоступен)")
    return "\n\n".join(chunks)


def _normalize_channel(link: str) -> str | None:
    """Из ссылки/имени получает username канала."""
    link = link.strip()
    m = re.search(r"t\.me/(?:s/)?([A-Za-z0-9_]{4,})", link)
    if m:
        return m.group(1)
    if link.startswith("@"):
        return link[1:]
    if re.fullmatch(r"[A-Za-z0-9_]{4,}", link):
        return link
    return None


async def scrape_channel(link: str, max_posts: int = 25) -> list[str]:
    """
    Читает последние посты публичного канала через t.me/s/<username>.
    Работает только для ОТКРЫТЫХ каналов (у закрытых нет web-превью).
    """
    username = _normalize_channel(link)
    if not username:
        return []

    url = f"https://t.me/s/{username}"
    async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers={
        "User-Agent": "Mozilla/5.0 (compatible; PostBot/1.0)"
    }) as client:
        try:
            r = await client.get(url)
            html = r.text
        except Exception as e:
            logger.warning(f"Не удалось прочитать канал {url}: {e}")
            return []

    # Текст постов лежит в div с классом tgme_widget_message_text
    blocks = re.findall(
        r'<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>',
        html, re.DOTALL
    )
    posts = []
    for b in blocks[-max_posts:]:
        # <br> -> перенос строки, остальные теги вырезаем
        b = b.replace("<br/>", "\n").replace("<br>", "\n")
        txt = _html_to_text(b, 1500)
        if txt:
            posts.append(txt)
    return posts
