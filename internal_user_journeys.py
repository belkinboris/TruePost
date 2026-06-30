"""
GET /api/internal/user-journeys для Growth Agent.

Per-user воронка: путь конкретного (анонимизированного) пользователя от
регистрации до оплаты, чтобы Growth Agent мог объяснить "застрял на каком
шаге", а не только агрегаты по всем пользователям сразу.

Жёсткие ограничения (см. задачу):
- НЕ отдаёт персональные данные (email, tg_username, телефон) -- только
  user_key (анонимный, неинвертируемый идентификатор).
- НЕ отдаёт тексты постов -- Post.text никогда не читается этим модулем.
- НЕ использует raw post_generations (Post count) как сигнал вовлечённости
  для last_step/stuck_at -- эта метрика инфлируется автогенерацией очереди
  (см. payment-path diagnostics post_generations_breakdown) и легко вводит
  в заблуждение про то, "дошёл ли пользователь до конца воронки".
- Только internal token, тот же механизм что у остальных internal-эндпоинтов.

Подключение в main.py (рядом с payment_path_router):

    from internal_user_journeys import router as user_journeys_router
    app.include_router(user_journeys_router)

Использует тот же токен:
    TRUEPOST_INTERNAL_API_TOKEN (Authorization: Bearer {token})
"""

import hashlib
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException, Query
from sqlmodel import select

import database
from database import User, Channel, Payment, ProductEvent, TrafficAttribution

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


def _period_start(period_hours: int):
    return datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=period_hours)


def _make_user_key(user_id: int) -> str:
    """
    Стабильный анонимный идентификатор: не email, не username, не телефон,
    необратимый (нельзя восстановить user_id зная только user_key без
    исходного INTERNAL_API_TOKEN -- используем его как соль, чтобы хэш не
    совпадал с публично вычислимым sha256(user_id)).

    "Стабильный" значит: один и тот же user_id всегда даёт один и тот же
    user_key в рамках одного и того же значения TRUEPOST_INTERNAL_API_TOKEN.
    Если токен ротируется (см. задачу про ротацию токена) -- user_key
    пользователей изменится. Это приемлемо: Growth Agent не хранит долгую
    историю по user_key между ротациями токена, читает свежий снепшот.
    """
    salt = INTERNAL_API_TOKEN or "no-token-configured"
    digest = hashlib.sha256(f"{salt}:{user_id}".encode()).hexdigest()
    return f"u_{digest[:8]}"


def _iso(dt) -> str | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z") if dt.tzinfo is None else dt.isoformat()


# last_step: порядок шагов от самого раннего к самому позднему. Последний
# присутствующий (не None) шаг в этом списке и есть last_step.
_STEP_ORDER = [
    ("registered", "registered_at"),
    ("channel_created", "channel_created_at"),
    ("onboarding_selected", "_onboarding_choice_at"),
    ("first_post_feedback_good", "_feedback_good_at"),
    ("first_post_feedback_bad", "_feedback_bad_at"),
    ("pricing_viewed", "pricing_viewed_at"),
    ("payment_started", "payment_started_at"),
    ("payment_failed", "_payment_failed_at"),
    ("payment_success", "payment_success_at"),
]


def _compute_last_step(j: dict) -> str:
    last = "registered"
    for step_name, field in _STEP_ORDER:
        if j.get(field):
            last = step_name
    return last


def _compute_stuck_at(j: dict, last_step: str) -> str:
    """
    Грубая, понятная бизнес-классификация "на чём застрял". Намеренно не
    использует post_generations -- генерации (особенно автоматические,
    см. post_generations_breakdown в payment-path diagnostics) не означают
    что пользователь дошёл до какого-то конкретного шага воронки оплаты.
    """
    if j.get("payment_success_at"):
        return "paid"
    if j.get("payment_started_at") or j.get("_payment_failed_at"):
        return "payment_path"
    if j.get("pricing_viewed_at"):
        return "tariff_screen"
    if j.get("_feedback_good_at") or j.get("_feedback_bad_at"):
        return "after_first_post"
    if j.get("channel_created_at"):
        return "after_channel_created"
    if j.get("registered_at"):
        return "after_registration"
    return "unknown"


@router.get("/api/internal/user-journeys")
def user_journeys(
    period_hours: int = 24,
    limit: int = Query(default=100, le=500),
    authorization: str | None = Header(default=None),
):
    """
    Read-only per-user journey: путь конкретного (анонимизированного)
    пользователя от регистрации до оплаты, для случаев когда агрегатов
    (payment-path-diagnostics) недостаточно и нужно увидеть "вот этот
    конкретный пользователь застрял здесь".

    "Значимое событие за период" = регистрация ИЛИ любое ProductEvent ИЛИ
    Payment, попадающее в период [now - period_hours, now]. Если у юзера
    единственное событие за период -- например он зарегистрировался месяц
    назад но сегодня кликнул pricing_viewed -- он всё равно попадёт в
    выдачу (потому что just произошло значимое событие сегодня), но в
    journey будут видны ВСЕ его шаги, включая те что были раньше периода
    (registered_at может быть месячной давности). Это сделано намеренно:
    обрезать историю по периоду было бы менее полезно для диагностики "на
    чём застрял" -- застревание часто происходит давно, а не в последние
    period_hours.
    """
    _check_auth(authorization)
    since = _period_start(period_hours)
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with database.session() as s:
        # 1. Находим user_id с любым значимым событием за период.
        recent_user_ids = set()

        recent_users = s.exec(select(User.id).where(User.created_at >= since)).all()
        recent_user_ids.update(recent_users)

        recent_pe = s.exec(
            select(ProductEvent.user_id).where(
                ProductEvent.created_at >= since, ProductEvent.user_id != None  # noqa: E711
            )
        ).all()
        recent_user_ids.update(recent_pe)

        recent_payments = s.exec(
            select(Payment.user_id).where(Payment.created_at >= since)
        ).all()
        recent_user_ids.update(recent_payments)

        if not recent_user_ids:
            return {
                "ok": True,
                "period_hours": period_hours,
                "as_of": _iso(now),
                "journeys": [],
            }

        # limit применяется к итоговому списку юзеров (после сортировки по
        # last activity ниже), не к промежуточным запросам -- иначе можно
        # случайно отрезать юзера с активностью просто из-за порядка обхода.
        candidate_ids = recent_user_ids

        # 2. Тянем нужные данные одним проходом на candidate_ids, без
        # лишних точечных запросов в цикле (N+1) -- иначе при limit=500
        # это превращается в тысячи запросов.
        users_rows = s.exec(
            select(User.id, User.created_at).where(User.id.in_(candidate_ids))
        ).all()
        users_by_id = {uid: created_at for uid, created_at in users_rows}

        channels_rows = s.exec(
            select(Channel.user_id, Channel.created_at).where(Channel.user_id.in_(candidate_ids))
        ).all()
        # Берём САМЫЙ РАННИЙ канал на юзера -- это и есть "когда впервые
        # подключил канал", повторные каналы не должны переписывать этот момент.
        channel_created_by_user: dict[int, datetime] = {}
        for uid, created_at in channels_rows:
            if uid not in channel_created_by_user or created_at < channel_created_by_user[uid]:
                channel_created_by_user[uid] = created_at

        pe_rows = s.exec(
            select(ProductEvent.user_id, ProductEvent.event, ProductEvent.package_id, ProductEvent.created_at)
            .where(ProductEvent.user_id.in_(candidate_ids))
        ).all()

        payment_rows = s.exec(
            select(Payment.user_id, Payment.status, Payment.created_at, Payment.paid_at)
            .where(Payment.user_id.in_(candidate_ids))
        ).all()

        attrib_rows = s.exec(
            select(
                TrafficAttribution.user_id, TrafficAttribution.source,
                TrafficAttribution.campaign, TrafficAttribution.content,
            ).where(TrafficAttribution.user_id.in_(candidate_ids))
        ).all()
        attrib_by_user = {}
        for uid, source, campaign, content in attrib_rows:
            if uid not in attrib_by_user:  # первая запись на юзера, без перезаписи
                attrib_by_user[uid] = {"source": source, "campaign": campaign, "content": content}

        # 3. Группируем ProductEvent по юзеру -- нужен САМЫЙ РАННИЙ момент
        # каждого типа события (первый раз когда это произошло), не последний.
        pe_by_user: dict[int, dict] = {}
        for uid, event, package_id, created_at in pe_rows:
            bucket = pe_by_user.setdefault(uid, {})
            key = (event, package_id)
            if key not in bucket or created_at < bucket[key]:
                bucket[key] = created_at
            # Также сохраняем "первое первое" событие данного типа независимо
            # от package_id (нужно для onboarding_choice_selected -- любой
            # package_id, pricing_viewed -- package_id обычно пустой).
            key_any = (event, "*")
            if key_any not in bucket or created_at < bucket[key_any]:
                bucket[key_any] = created_at

        # 4. Группируем Payment по юзеру -- самый ранний payment_started
        # (создание Payment), самый ранний успешный (status=='paid'),
        # самый ранний failed.
        payment_by_user: dict[int, dict] = {}
        for uid, status, created_at, paid_at in payment_rows:
            bucket = payment_by_user.setdefault(uid, {"started_at": None, "success_at": None, "failed_at": None})
            if bucket["started_at"] is None or created_at < bucket["started_at"]:
                bucket["started_at"] = created_at
            if status == "paid":
                success_at = paid_at or created_at
                if bucket["success_at"] is None or success_at < bucket["success_at"]:
                    bucket["success_at"] = success_at
            if status == "failed":
                if bucket["failed_at"] is None or created_at < bucket["failed_at"]:
                    bucket["failed_at"] = created_at

        # 5. Собираем journey на каждого кандидата.
        journeys = []
        for uid in candidate_ids:
            registered_at = users_by_id.get(uid)
            if registered_at is None:
                # Юзер мог быть удалён между сбором candidate_ids и этим
                # запросом (delete account) -- пропускаем, не падаем.
                continue

            pe = pe_by_user.get(uid, {})
            pay = payment_by_user.get(uid, {"started_at": None, "success_at": None, "failed_at": None})
            attrib = attrib_by_user.get(uid)

            onboarding_choice_at = pe.get(("onboarding_choice_selected", "*"))
            onboarding_choice_value = None
            for choice in ("generate_first_post", "analyze_existing_channel", "skip"):
                if ("onboarding_choice_selected", choice) in pe:
                    onboarding_choice_value = choice
                    break

            feedback_good_at = pe.get(("first_post_feedback", "good"))
            feedback_bad_at = pe.get(("first_post_feedback", "bad"))
            feedback_reason_value = None
            feedback_reason_at = None
            for reason in ("too_generic", "wrong_style", "wrong_topic", "too_dry", "too_salesy", "other"):
                key = ("first_post_feedback_reason", reason)
                if key in pe:
                    feedback_reason_value = reason
                    feedback_reason_at = pe[key]
                    break

            j = {
                "user_key": _make_user_key(uid),
                "source": (attrib["source"] if attrib else "unknown"),
                "utm_source": (attrib["source"] if attrib else None),
                "utm_campaign": (attrib["campaign"] if attrib else None) or None,
                "utm_content": (attrib["content"] if attrib else None) or None,

                "registered_at": _iso(registered_at),
                "channel_created_at": _iso(channel_created_by_user.get(uid)),
                "onboarding_choice": onboarding_choice_value,

                "first_post_feedback": ("good" if feedback_good_at else ("bad" if feedback_bad_at else None)),
                "first_post_feedback_reason": feedback_reason_value,
                "first_post_feedback_at": _iso(feedback_good_at or feedback_bad_at),

                "pricing_viewed_at": _iso(pe.get(("pricing_viewed", "*"))),
                "payment_cta_clicked_at": _iso(pe.get(("payment_cta_clicked", "*"))),
                "payment_started_at": _iso(pay["started_at"]),
                "payment_success_at": _iso(pay["success_at"]),

                # Внутренние поля для вычисления last_step/stuck_at, не
                # часть публичного контракта -- удаляются перед отдачей.
                "_onboarding_choice_at": onboarding_choice_at,
                "_feedback_good_at": feedback_good_at,
                "_feedback_bad_at": feedback_bad_at,
                "_payment_failed_at": pay["failed_at"],
            }

            last_step = _compute_last_step(j)
            stuck_at = _compute_stuck_at(j, last_step)

            # Последний известный момент активности -- максимум среди всех
            # непустых timestamp'ов -- нужен для minutes_since_last_step и
            # для сортировки выдачи (самые свежие сначала).
            all_moments = [
                registered_at, channel_created_by_user.get(uid),
                onboarding_choice_at, feedback_good_at, feedback_bad_at, feedback_reason_at,
                pe.get(("pricing_viewed", "*")), pe.get(("payment_cta_clicked", "*")),
                pay["started_at"], pay["success_at"], pay["failed_at"],
            ]
            last_moment = max((m for m in all_moments if m is not None), default=registered_at)
            minutes_since = int((now - last_moment).total_seconds() // 60) if last_moment else None

            # Чистим внутренние поля перед отдачей -- наружу не уходят.
            for internal_key in ["_onboarding_choice_at", "_feedback_good_at", "_feedback_bad_at", "_payment_failed_at"]:
                j.pop(internal_key, None)

            j["payment_failed_at"] = _iso(pay["failed_at"])
            j["last_step"] = last_step
            j["stuck_at"] = stuck_at
            j["minutes_since_last_step"] = minutes_since
            j["_sort_key"] = last_moment

            journeys.append(j)

        journeys.sort(key=lambda x: x["_sort_key"], reverse=True)
        for j in journeys:
            del j["_sort_key"]
        journeys = journeys[:limit]

    return {
        "ok": True,
        "period_hours": period_hours,
        "as_of": _iso(now),
        "journeys": journeys,
    }
