"""
GET /api/internal/landing-funnel-diagnostics для Growth Agent.

CTA/Journey Diagnostics: read-only агрегация событий из LandingEvent,
чтобы понять где именно рвётся путь landing -> Telegram/web -> registration.
Никакой бизнес-логики не трогает, только чтение.

Подключение в main.py (рядом с internal_metrics, если он подключён):

    from internal_landing_funnel import router as landing_funnel_router
    app.include_router(landing_funnel_router)

Использует тот же токен что и internal_metrics.py:
    TRUEPOST_INTERNAL_API_TOKEN (Authorization: Bearer {token})
"""

import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException
from sqlmodel import select, func

import database
from database import LandingEvent

router = APIRouter()

INTERNAL_API_TOKEN = os.environ.get("TRUEPOST_INTERNAL_API_TOKEN")


def _check_auth(authorization: str | None) -> None:
    if not INTERNAL_API_TOKEN:
        raise HTTPException(status_code=503, detail="TRUEPOST_INTERNAL_API_TOKEN not configured on this server")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.removeprefix("Bearer ").strip()
    if token != INTERNAL_API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")


# Порядок шагов воронки как в задаче (Part 5)
_FUNNEL_STEPS = [
    "landing_view",
    "cta_hero_bot_click",
    "cta_hero_app_click",
    "cta_header_click",
    "cta_final_click",
    "bot_start_from_landing",
    "web_register_opened",
    "register_success",
    "activation_1",
]


@router.get("/api/internal/landing-funnel-diagnostics")
async def landing_funnel_diagnostics(
    period_hours: int = 24,
    authorization: str | None = Header(default=None),
):
    _check_auth(authorization)

    now_aware = datetime.now(timezone.utc)
    now_naive = now_aware.replace(tzinfo=None)  # created_at в БД наивный UTC
    period_start = now_naive - timedelta(hours=period_hours)

    with database.session() as s:
        raw_counts = {}
        unique_counts = {}
        for step in _FUNNEL_STEPS:
            # raw — сырое количество строк, включая возможные дубли отправки
            # (например, повторный fetch при flaky-сети или re-render).
            raw_counts[step] = s.exec(
                select(func.count(LandingEvent.id)).where(
                    LandingEvent.created_at >= period_start,
                    LandingEvent.event == step,
                )
            ).one()

            # unique — реальная воронка: считаем уникальных людей/сессий, не строки.
            # register_success: уникальные user_id, если они проставлены (backend
            # всегда проставляет user_id при записи), иначе уникальные session_id
            # как fallback для старых/ручных событий без user_id.
            if step == "register_success":
                unique_counts[step] = s.exec(
                    select(func.count(func.distinct(LandingEvent.user_id))).where(
                        LandingEvent.created_at >= period_start,
                        LandingEvent.event == step,
                        LandingEvent.user_id.is_not(None),
                    )
                ).one()
                # Добор событий без user_id (не должно происходить из backend,
                # но подстраховка на случай ручных/будущих вызовов через
                # /api/landing-event без user_id) — считаем их по session_id,
                # чтобы не терять сигнал, но не задвоить с уже посчитанными user_id.
                no_user_id_sessions = s.exec(
                    select(func.count(func.distinct(LandingEvent.session_id))).where(
                        LandingEvent.created_at >= period_start,
                        LandingEvent.event == step,
                        LandingEvent.user_id.is_(None),
                    )
                ).one()
                unique_counts[step] += no_user_id_sessions
            else:
                # Остальные шаги — считаем уникальные session_id за период.
                unique_counts[step] = s.exec(
                    select(func.count(func.distinct(LandingEvent.session_id))).where(
                        LandingEvent.created_at >= period_start,
                        LandingEvent.event == step,
                    )
                ).one()

    dropoff_summary = [
        {"step": step, "count": unique_counts[step], "raw_count": raw_counts[step]}
        for step in _FUNNEL_STEPS
    ]

    notes = []
    views = unique_counts["landing_view"]
    bot_clicks = unique_counts["cta_hero_bot_click"]
    app_clicks = unique_counts["cta_hero_app_click"]
    bot_starts = unique_counts["bot_start_from_landing"]
    web_opened = unique_counts["web_register_opened"]
    registers = unique_counts["register_success"]

    # Если raw сильно расходится с unique — отдельная заметка про дубли,
    # это полезно знать прежде чем доверять воронке.
    for step in _FUNNEL_STEPS:
        if raw_counts[step] > unique_counts[step] * 1.5 and raw_counts[step] >= 4:
            notes.append(
                f"'{step}': raw_count={raw_counts[step]} заметно выше unique count="
                f"{unique_counts[step]} — событие отправляется повторно чаще чем "
                f"ожидается (re-render, повторный fetch и т.п.). Funnel считается по "
                f"unique, но стоит проверить источник дублей на фронте."
            )

    if views == 0:
        notes.append("Нет данных о просмотрах лендинга за период — диагностика невозможна, либо событие landing_view не долетает.")
    elif (bot_clicks + app_clicks) == 0:
        notes.append("Пользователи почти не нажимают CTA. Вероятная проблема — первый экран или оффер.")
    else:
        if bot_clicks > 0 and bot_starts == 0:
            notes.append(
                "Пользователи нажимают Telegram CTA, но bot_start_from_landing = 0. "
                "Архитектура: @maintrpost_bot — это не отдельный backend, а вход в "
                "Telegram Mini App (Web App), прикреплённый через BotFather к "
                "autopost26.up.railway.app. Поэтому bot_start_from_landing здесь — это "
                "событие открытия Mini App (читается из Telegram.WebApp.initDataUnsafe."
                "start_param при ?startapp=lp_<session_id>), а НЕ серверный /start у бота "
                "через Bot API. Если показатель равен 0, проверь: установлен ли в "
                "BotFather основной Mini App именно на этот URL, и доходит ли deep link "
                "?startapp=lp_... до реального открытия приложения в Telegram."
            )
        if bot_starts > 0 and registers == 0 and web_opened == 0:
            notes.append(
                "Пользователи доходят до Telegram-бота (bot_start_from_landing > 0), "
                "но не открывают веб-регистрацию (web_register_opened = 0). "
                "Вероятная проблема — бот не объясняет новый пользовательский путь "
                "или пользователь не доходит до ссылки регистрации."
            )
        if app_clicks > 0 and web_opened == 0:
            notes.append(
                "Пользователи нажимают веб CTA, но web_register_opened = 0. "
                "Возможна проблема с захватом lp_session на стороне веб-приложения."
            )
        if web_opened > 0 and registers == 0:
            notes.append("Пользователи идут в web, но не завершают регистрацию. Вероятная проблема — web registration flow.")
        if registers > 0:
            notes.append(f"register_success зафиксирован {registers} раз(а) (уникальных пользователей) с атрибуцией к лендингу — путь работает хотя бы частично.")

    return {
        "period_hours": period_hours,
        "as_of": now_aware.isoformat().replace("+00:00", "Z"),
        "landing_views": views,
        "landing_views_raw": raw_counts["landing_view"],
        "cta_hero_bot_clicks": bot_clicks,
        "cta_hero_bot_clicks_raw": raw_counts["cta_hero_bot_click"],
        "cta_hero_app_clicks": app_clicks,
        "cta_hero_app_clicks_raw": raw_counts["cta_hero_app_click"],
        "cta_header_clicks": unique_counts["cta_header_click"],
        "cta_header_clicks_raw": raw_counts["cta_header_click"],
        "cta_final_clicks": unique_counts["cta_final_click"],
        "cta_final_clicks_raw": raw_counts["cta_final_click"],
        "bot_starts_from_landing": bot_starts,
        "bot_starts_from_landing_raw": raw_counts["bot_start_from_landing"],
        "web_register_opened": web_opened,
        "web_register_opened_raw": raw_counts["web_register_opened"],
        "register_success": registers,
        "register_success_raw": raw_counts["register_success"],
        "activation_1": unique_counts["activation_1"],
        "activation_1_raw": raw_counts["activation_1"],
        "dropoff_summary": dropoff_summary,
        "diagnostic_notes": notes,
    }
