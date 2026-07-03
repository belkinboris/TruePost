"""
GET /api/internal/user-events для Growth Agent (Founder Live Feed).

ДИСКРЕТНЫЕ события с уникальным event_id -- в отличие от
/api/internal/user-journeys (снимок текущего состояния пути), этот endpoint
отдаёт "что произошло за последние N минут" как список отдельных событий.
Growth Agent дедуплицирует по event_id и шлёт владельцу live-уведомления
без snapshot-diffing.

Контракт согласован с growthagent/app/connectors/user_events.py:

{
  "ok": true,
  "period_minutes": 120,
  "as_of": "...Z",
  "events": [
    {
      "event_id": "...",            # стабильный, уникальный, детерминированный
      "event_type": "user_registered" | "channel_created" |
                    "onboarding_choice" |
                    "first_post_feedback_good" | "first_post_feedback_bad" |
                    "pricing_viewed" | "payment_cta_clicked" |
                    "payment_started" | "payment_success" | "payment_failed",
      "user_key": "u_...",          # тот же анонимный ключ что в user-journeys
      "source": "...", "utm_source": "...",
      "utm_campaign": "...", "utm_content": "...",
      "created_at": "...Z",
      "journey_snapshot": {
        "registered": bool, "channel_created": bool,
        "onboarding_choice": str|None,
        "first_post_feedback": "good"|"bad"|None,
        "first_post_feedback_reason": str|None,
        "pricing_viewed": bool, "payment_cta_clicked": bool,
        "payment_started": bool, "payment_success": bool,
        "payment_failed": bool, "stuck_at": str|None
      }
    }
  ]
}

Жёсткие ограничения (те же что у user-journeys):
- НИКАКИХ персональных данных: email, tg_username, tg_chat_id, телефон,
  пароль не читаются и не возвращаются. Только user_key.
- Модуль НЕ импортирует Post и физически не может отдать тексты постов
  или raw post_generations как событие. post_generated / auto_post_created
  НЕ являются user-events по определению (автогенерация очереди инфлирует
  их без действий пользователя) -- их здесь просто нет.
- payment_returned / quota_warning_seen / limit_reached намеренно НЕ
  события live feed: payment_returned не означает успешную оплату
  (см. internal_payment_path.py), остальные два -- шум для владельца.
- ProductEvent('payment_failed') намеренно НЕ отдаётся вторым событием:
  источник истины по платежам -- таблица Payment (status == 'failed'),
  иначе одно событие пришло бы владельцу дважды под разными event_id.
- Только internal token, тот же механизм что у остальных internal-эндпоинтов.

event_id детерминированы и стабильны между запросами (иначе дедупликация
Growth Agent не работает):
    reg_{user_id}            -- регистрация
    ch_{channel_id}          -- создание канала
    pe_{product_event_id}    -- события из ProductEvent
    pay_{payment_id}_started -- создание Payment
    pay_{payment_id}_success -- Payment.status == 'paid'
    pay_{payment_id}_failed  -- Payment.status == 'failed'

Подключение в main.py (рядом с user_journeys_router):

    from internal_user_events import router as user_events_router
    app.include_router(user_events_router)

Использует тот же токен: TRUEPOST_INTERNAL_API_TOKEN (Authorization: Bearer).
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException, Query
from sqlmodel import select

import database
from database import User, Channel, Payment, ProductEvent, TrafficAttribution

# Переиспользуем проверку токена и анонимный user_key из user-journeys --
# у обоих endpoint'ов ДОЛЖЕН быть один и тот же user_key для одного user_id,
# иначе Growth Agent не сможет сопоставить событие с journey.
from internal_user_journeys import _check_auth, _make_user_key, _iso

router = APIRouter()

# Максимальный период: 24 часа. Live feed по определению работает с коротким
# окном; для длинных периодов есть user-journeys и payment-path-diagnostics.
_MAX_PERIOD_MINUTES = 24 * 60


def _period_start(period_minutes: int) -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=period_minutes)


# ProductEvent.event -> event_type live feed. Всё, чего нет в этой карте,
# в live feed не попадает (payment_returned, quota_warning_seen,
# limit_reached, first_post_feedback_reason -- reason уходит внутрь
# journey_snapshot, а не отдельным событием).
def _map_product_event(event: str, package_id: str) -> str | None:
    if event == "onboarding_choice_selected":
        return "onboarding_choice"
    if event == "first_post_feedback":
        if package_id == "good":
            return "first_post_feedback_good"
        if package_id == "bad":
            return "first_post_feedback_bad"
        return None
    if event == "pricing_viewed":
        return "pricing_viewed"
    if event == "payment_cta_clicked":
        return "payment_cta_clicked"
    return None


def _compute_stuck_at_snapshot(snap: dict) -> str:
    """
    Та же бизнес-классификация что в internal_user_journeys._compute_stuck_at,
    но на булевом снимке (без timestamp'ов). Порядок проверок идентичен.
    """
    if snap.get("payment_success"):
        return "paid"
    if snap.get("payment_started") or snap.get("payment_failed"):
        return "payment_path"
    if snap.get("pricing_viewed"):
        return "tariff_screen"
    if snap.get("first_post_feedback"):
        return "after_first_post"
    if snap.get("channel_created"):
        return "after_channel_created"
    if snap.get("registered"):
        return "after_registration"
    return "unknown"


@router.get("/api/internal/user-events")
def user_events(
    period_minutes: int = Query(default=120, ge=1, le=_MAX_PERIOD_MINUTES),
    limit: int = Query(default=200, ge=1, le=500),
    authorization: str | None = Header(default=None),
):
    """
    Read-only дискретные события пользователей за период для Founder Live
    Feed. Каждое событие имеет стабильный event_id -- Growth Agent
    дедуплицирует по нему и не присылает владельцу одно событие дважды.
    """
    _check_auth(authorization)
    since = _period_start(period_minutes)
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with database.session() as s:
        # --- 1. Сырые события за период -------------------------------------

        # (event_id, event_type, user_id, created_at)
        raw_events: list[tuple[str, str, int, datetime]] = []

        reg_rows = s.exec(
            select(User.id, User.created_at).where(User.created_at >= since)
        ).all()
        for uid, created_at in reg_rows:
            raw_events.append((f"reg_{uid}", "user_registered", uid, created_at))

        ch_rows = s.exec(
            select(Channel.id, Channel.user_id, Channel.created_at).where(
                Channel.created_at >= since
            )
        ).all()
        for cid, uid, created_at in ch_rows:
            raw_events.append((f"ch_{cid}", "channel_created", uid, created_at))

        pe_rows = s.exec(
            select(
                ProductEvent.id, ProductEvent.user_id, ProductEvent.event,
                ProductEvent.package_id, ProductEvent.created_at,
            ).where(
                ProductEvent.created_at >= since,
                ProductEvent.user_id != None,  # noqa: E711
            )
        ).all()
        for pe_id, uid, event, package_id, created_at in pe_rows:
            etype = _map_product_event(event, package_id or "")
            if etype is not None:
                raw_events.append((f"pe_{pe_id}", etype, uid, created_at))

        pay_rows_recent = s.exec(
            select(
                Payment.id, Payment.user_id, Payment.status,
                Payment.created_at, Payment.paid_at,
            ).where(Payment.created_at >= since)
        ).all()
        # payment_started -- создание Payment.
        for pid, uid, status, created_at, paid_at in pay_rows_recent:
            raw_events.append((f"pay_{pid}_started", "payment_started", uid, created_at))
            if status == "failed":
                raw_events.append((f"pay_{pid}_failed", "payment_failed", uid, created_at))

        # payment_success ищем отдельным запросом по paid_at: оплата могла
        # завершиться внутри периода даже если Payment создан раньше него.
        pay_success_rows = s.exec(
            select(Payment.id, Payment.user_id, Payment.created_at, Payment.paid_at).where(
                Payment.status == "paid"
            )
        ).all()
        for pid, uid, created_at, paid_at in pay_success_rows:
            success_at = paid_at or created_at
            if success_at >= since:
                raw_events.append((f"pay_{pid}_success", "payment_success", uid, success_at))

        if not raw_events:
            return {
                "ok": True,
                "period_minutes": period_minutes,
                "as_of": _iso(now),
                "events": [],
            }

        # --- 2. Journey snapshot + attribution пакетно на затронутых юзеров --

        involved_ids = {uid for _, _, uid, _ in raw_events}

        snap_users = set(
            s.exec(select(User.id).where(User.id.in_(involved_ids))).all()
        )
        snap_channels = set(
            s.exec(
                select(Channel.user_id).where(Channel.user_id.in_(involved_ids))
            ).all()
        )

        snap_pe_rows = s.exec(
            select(ProductEvent.user_id, ProductEvent.event, ProductEvent.package_id)
            .where(ProductEvent.user_id.in_(involved_ids))
        ).all()
        pe_by_user: dict[int, dict] = {}
        for uid, event, package_id in snap_pe_rows:
            b = pe_by_user.setdefault(uid, {
                "onboarding_choice": None, "feedback": None, "feedback_reason": None,
                "pricing_viewed": False, "payment_cta_clicked": False,
            })
            if event == "onboarding_choice_selected" and b["onboarding_choice"] is None:
                b["onboarding_choice"] = (package_id or None)
            elif event == "first_post_feedback" and b["feedback"] is None and package_id in ("good", "bad"):
                b["feedback"] = package_id
            elif event == "first_post_feedback_reason" and b["feedback_reason"] is None:
                b["feedback_reason"] = (package_id or None)
            elif event == "pricing_viewed":
                b["pricing_viewed"] = True
            elif event == "payment_cta_clicked":
                b["payment_cta_clicked"] = True

        snap_pay_rows = s.exec(
            select(Payment.user_id, Payment.status).where(Payment.user_id.in_(involved_ids))
        ).all()
        pay_by_user: dict[int, dict] = {}
        for uid, status in snap_pay_rows:
            b = pay_by_user.setdefault(uid, {"started": False, "success": False, "failed": False})
            b["started"] = True
            if status == "paid":
                b["success"] = True
            if status == "failed":
                b["failed"] = True

        attrib_rows = s.exec(
            select(
                TrafficAttribution.user_id, TrafficAttribution.source,
                TrafficAttribution.campaign, TrafficAttribution.content,
            ).where(TrafficAttribution.user_id.in_(involved_ids))
        ).all()
        attrib_by_user: dict[int, dict] = {}
        for uid, source, campaign, content in attrib_rows:
            if uid not in attrib_by_user:  # первая запись, без перезаписи
                attrib_by_user[uid] = {"source": source, "campaign": campaign, "content": content}

        # --- 3. Сборка ответа ------------------------------------------------

        # Свежие сначала; при равном времени -- стабильный порядок по event_id,
        # чтобы limit отрезал детерминированно.
        raw_events.sort(key=lambda e: (e[3], e[0]), reverse=True)
        raw_events = raw_events[:limit]

        events = []
        for event_id, event_type, uid, created_at in raw_events:
            pe = pe_by_user.get(uid, {})
            pay = pay_by_user.get(uid, {})
            attrib = attrib_by_user.get(uid)

            snapshot = {
                "registered": uid in snap_users,
                "channel_created": uid in snap_channels,
                "onboarding_choice": pe.get("onboarding_choice"),
                "first_post_feedback": pe.get("feedback"),
                "first_post_feedback_reason": pe.get("feedback_reason"),
                "pricing_viewed": bool(pe.get("pricing_viewed")),
                "payment_cta_clicked": bool(pe.get("payment_cta_clicked")),
                "payment_started": bool(pay.get("started")),
                "payment_success": bool(pay.get("success")),
                "payment_failed": bool(pay.get("failed")),
            }
            snapshot["stuck_at"] = _compute_stuck_at_snapshot(snapshot)

            events.append({
                "event_id": event_id,
                "event_type": event_type,
                "user_key": _make_user_key(uid),
                "source": (attrib["source"] if attrib else "unknown"),
                "utm_source": (attrib["source"] if attrib else None),
                "utm_campaign": (attrib["campaign"] if attrib else None) or None,
                "utm_content": (attrib["content"] if attrib else None) or None,
                "created_at": _iso(created_at),
                "journey_snapshot": snapshot,
            })

    return {
        "ok": True,
        "period_minutes": period_minutes,
        "as_of": _iso(now),
        "events": events,
    }
