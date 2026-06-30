"""
Нормализация источника трафика (attribution) для TrafficAttribution.

Два входа поддерживаются:
1. Веб: ?utm_source=telegram_ads&utm_medium=cpc&utm_campaign=...&utm_content=...
2. Telegram: /start tgads_<campaign>_<content>  (или просто /start tgads_<что угодно>)

Намеренно простая эвристика, без внешних зависимостей. Если расширение
понадобится (новые источники, более сложный парсинг start-параметра) --
делать осознанно отдельной правкой, не разрастать это вслепую.
"""

from __future__ import annotations


def classify_utm(utm_source: str, utm_medium: str) -> tuple[str, str]:
    """
    UTM -> (source, medium). Используется на лендинге.

    Известные источники:
        telegram_ads -- любой utm_source содержащий 'telegram' и связанный с Ads
        yandex_direct -- utm_source == 'yandex' / 'direct' / содержит 'yandex'
        direct -- прямой заход (нет UTM вообще, но это решается выше по вызову,
            здесь только классификация при наличии utm_source)
        unknown -- всё остальное / нет данных
    """
    src = (utm_source or "").strip().lower()
    med = (utm_medium or "").strip().lower()

    if not src:
        return "unknown", "unknown"

    if "telegram" in src or src in ("tg_ads", "tgads"):
        return "telegram_ads", (med or "cpc")

    if "yandex" in src or src in ("direct", "ya_direct", "yadirect"):
        return "yandex_direct", (med or "cpc")

    medium_out = med if med else "unknown"
    return src, medium_out


def classify_start_param(raw: str) -> tuple[str, str, str, str]:
    """
    Telegram /start <param> -> (source, medium, campaign, content).

    Конвенция:
        tgads_<campaign>_<content>   -> telegram_ads, cpc, campaign, content
        tgads_<campaign>             -> telegram_ads, cpc, campaign, ""
        tgads                        -> telegram_ads, cpc, "", ""
        lp_<session_id>              -> не источник трафика, это сессия лендинга
                                         (обрабатывается отдельно в captureLandingSession,
                                         здесь возвращаем unknown чтобы не задвоить)
        u<user_id>                   -> существующая линковка аккаунта, не источник
        что угодно ещё / пусто       -> unknown, unknown, "", ""
    """
    raw = (raw or "").strip()
    if not raw:
        return "unknown", "unknown", "", ""

    if raw.startswith("lp_") or (raw.startswith("u") and raw[1:].isdigit()):
        # Это не источник трафика -- либо сессия лендинга, либо линковка
        # уже существующего аккаунта. Не путаем с attribution.
        return "unknown", "unknown", "", ""

    if raw.startswith("tgads"):
        rest = raw[len("tgads"):].lstrip("_")
        if not rest:
            return "telegram_ads", "cpc", "", ""
        parts = rest.split("_", 1)
        campaign = parts[0]
        content = parts[1] if len(parts) > 1 else ""
        return "telegram_ads", "cpc", campaign, content

    if raw.startswith("yads") or raw.startswith("direct_"):
        rest = raw.split("_", 1)
        campaign = rest[1] if len(rest) > 1 else ""
        return "yandex_direct", "cpc", campaign, ""

    # Неизвестный формат start-параметра -- не пытаемся угадать, честно unknown.
    return "unknown", "unknown", "", ""
