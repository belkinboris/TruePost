"""
GET /api/internal/payment-path-diagnostics для Growth Agent.

Отвечает на конкретный бизнес-вопрос: почему при наличии регистраций,
созданных каналов и генераций постов пока нет успешных оплат.

Намеренно минимальный: только backend truth (User/Channel/Post/Payment) +
несколько ProductEvent для шагов, которые иначе вообще не видны
(pricing_viewed, payment_cta_clicked, payment_failed, payment_returned).
Никакой source attribution (Yandex Direct vs Telegram Ads) -- для этого нет
надёжного сигнала прямо сейчас (UTM-конвенция для Telegram Ads ещё не
зафиксирована), добавлять это нужно отдельно и осознанно, не здесь.

Подключение в main.py (рядом с internal_metrics, internal_landing_funnel):

    from internal_payment_path import router as payment_path_router
    app.include_router(payment_path_router)

Использует тот же токен что и остальные internal-эндпоинты:
    TRUEPOST_INTERNAL_API_TOKEN (Authorization: Bearer {token})
"""

import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException
from sqlmodel import select, func

import database
from database import User, Channel, Post, Payment, ProductEvent, TrafficAttribution

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


# Карта событий: что является backend-фактом, что только frontend/Метрика-
# событием. Используется и в коде, и как документация для Growth Agent --
# чтобы не путать клик с фактом (см. урок из предыдущего ревью: чужая карта
# событий смешивала живые и мёртвые источники без разграничения).
EVENT_MAP = [
    {
        "stage": "registration",
        "backend_truth": "User row создан в /api/register",
        "metrika_goal": "register_success",
        "is_backend_fact": True,
    },
    {
        "stage": "channel_created",
        "backend_truth": "Channel row создан в /api/channels",
        "metrika_goal": "new_channel_settings_created (quick start использует другой путь, не отдельную Метрика-цель)",
        "is_backend_fact": True,
    },
    {
        "stage": "post_generated",
        "backend_truth": "Post row создан в tasks.generate_for_channel",
        "metrika_goal": "first_post_generated (quick start) / post_generated{source:manual|test} (карточка канала)",
        "is_backend_fact": True,
    },
    {
        "stage": "pricing_viewed",
        "backend_truth": "ProductEvent('pricing_viewed') -- добавлено этим патчем, раньше не логировалось вообще",
        "metrika_goal": "нет",
        "is_backend_fact": True,
    },
    {
        "stage": "payment_cta_clicked",
        "backend_truth": "ProductEvent('payment_cta_clicked') -- добавлено этим патчем, фиксирует клик ДО ответа backend",
        "metrika_goal": "нет (раньше payment_started фиксировался только ПОСЛЕ успешного создания Payment, клик до этого момента был не виден)",
        "is_backend_fact": True,
    },
    {
        "stage": "payment_started",
        "backend_truth": "Payment row создан в /api/billing/buy (status pending/succeeded/failed)",
        "metrika_goal": "payment_started (отправляется фронтом после успешного ответа /billing/buy -- то есть это уже backend-факт, не просто клик)",
        "is_backend_fact": True,
    },
    {
        "stage": "payment_success",
        "backend_truth": "Payment.status == 'paid', paid_at заполнен (webhook или sync через /api/yookassa/notify)",
        "metrika_goal": "payment_success",
        "is_backend_fact": True,
    },
    {
        "stage": "payment_failed",
        "backend_truth": "Payment.status == 'failed' (YooKassa error, либо provider не вернул confirmation_url) + ProductEvent('payment_failed') для случаев когда Payment не успел создаться",
        "metrika_goal": "нет",
        "is_backend_fact": True,
    },
    {
        "stage": "payment_returned",
        "backend_truth": "ProductEvent('payment_returned') -- фиксирует только возврат на /?paid=1, НЕ означает успешную оплату",
        "metrika_goal": "нет",
        "is_backend_fact": True,
    },
]

# Источники, которые показываются в source_breakdown явными ключами.
# Любой другой source (vk, mailto, custom utm_source и т.д.) попадает в "other".
_KNOWN_SOURCES = ["telegram_ads", "yandex_direct", "direct", "unknown"]


def _source_breakdown(s, since) -> dict:
    """
    Разбивка ключевых метрик воронки по источнику трафика (TrafficAttribution).

    Перед запуском Telegram Ads нужно отличать telegram_ads от yandex_direct
    от organic/unknown -- иначе обе рекламные кампании сольются в общие цифры
    и нельзя будет понять, какая реклама реально работает.

    Источник пользователя определяется по TrafficAttribution.user_id (см.
    /api/register пишет туда source/medium/campaign/content при наличии UTM
    или Telegram start-параметра, см. attribution.py). Пользователи без
    TrafficAttribution записи (старые аккаунты, прямой заход без меток)
    считаются source='unknown' -- это нормально и ожидаемо, см. задачу.

    Намеренно не включает данные о кликах/показах из рекламных кабинетов
    (eLama для Telegram Ads, Yandex Direct API) -- этот endpoint считает
    только события ПОСЛЕ перехода/регистрации в самом AutoPost.
    """
    # user_id -> source, для всех юзеров у кого есть TrafficAttribution
    attrib_rows = s.exec(
        select(TrafficAttribution.user_id, TrafficAttribution.source).where(
            TrafficAttribution.user_id != None  # noqa: E711
        )
    ).all()
    user_source = {}
    for user_id, source in attrib_rows:
        # Если на одного user_id почему-то несколько записей (теоретически
        # не должно происходить при текущей логике /api/register, но не
        # доверяем этому слепо) -- берём первую найденную, не перезаписываем.
        if user_id not in user_source:
            user_source[user_id] = source if source in _KNOWN_SOURCES else "other"

    def _bucket_for(user_id: int | None) -> str:
        if user_id is None:
            return "unknown"
        return user_source.get(user_id, "unknown")

    breakdown = {src: {
        "registrations": 0, "channels_created": 0, "post_generations": 0,
        "pricing_viewed": 0, "payment_cta_clicked": 0, "payment_started": 0, "payment_success": 0,
    } for src in (_KNOWN_SOURCES + ["other"])}

    # Регистрации за период, с их источником
    user_ids_in_period = set(s.exec(select(User.id).where(User.created_at >= since)).all())
    for uid in user_ids_in_period:
        breakdown[_bucket_for(uid)]["registrations"] += 1

    if not user_ids_in_period:
        return breakdown

    # Каналы за период, по user_id владельца
    channels = s.exec(
        select(Channel.user_id).where(Channel.created_at >= since)
    ).all()
    for uid in channels:
        if uid in user_ids_in_period:
            breakdown[_bucket_for(uid)]["channels_created"] += 1

    # Генерации постов за период, по user_id
    posts = s.exec(
        select(Post.user_id).where(Post.created_at >= since)
    ).all()
    for uid in posts:
        if uid in user_ids_in_period:
            breakdown[_bucket_for(uid)]["post_generations"] += 1

    # ProductEvent (pricing_viewed, payment_cta_clicked) -- по user_id
    for event_name, key in [
        ("pricing_viewed", "pricing_viewed"),
        ("payment_cta_clicked", "payment_cta_clicked"),
    ]:
        rows = s.exec(
            select(ProductEvent.user_id).where(
                ProductEvent.event == event_name, ProductEvent.created_at >= since,
                ProductEvent.user_id != None,  # noqa: E711
            )
        ).all()
        for uid in rows:
            if uid in user_ids_in_period:
                breakdown[_bucket_for(uid)][key] += 1

    # Payment (payment_started = создан, payment_success = status paid)
    payments = s.exec(
        select(Payment.user_id, Payment.status).where(Payment.created_at >= since)
    ).all()
    for uid, status in payments:
        if uid not in user_ids_in_period:
            continue
        bucket = breakdown[_bucket_for(uid)]
        bucket["payment_started"] += 1
        if status == "paid":
            bucket["payment_success"] += 1

    return breakdown


def _period_start(period_hours: int) -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=period_hours)


def _count_product_event(s, event: str, since: datetime) -> int:
    return s.exec(
        select(func.count()).select_from(ProductEvent).where(
            ProductEvent.event == event, ProductEvent.created_at >= since
        )
    ).one()


def _conversion_steps(counts: dict) -> list[dict]:
    """Последовательность шагов payment path с conversion rate относительно предыдущего шага."""
    order = [
        ("registrations", "Регистрации"),
        ("channels_created", "Создали канал"),
        ("post_generations", "Сгенерировали пост"),
        ("pricing_viewed", "Открыли тарифы"),
        ("payment_cta_clicked", "Кликнули оплату"),
        ("payment_started", "Платёж создан (backend)"),
        ("payment_success", "Оплата успешна"),
    ]
    steps = []
    prev_value = None
    for key, label in order:
        value = counts.get(key, 0)
        rate = None
        if prev_value is not None and prev_value > 0:
            rate = round(100 * value / prev_value, 1)
        steps.append({"stage": key, "label": label, "count": value, "conversion_from_prev_pct": rate})
        prev_value = value
    return steps


def _biggest_dropoff(steps: list[dict]) -> dict | None:
    """Шаг с наибольшим относительным падением count относительно предыдущего."""
    worst = None
    for i in range(1, len(steps)):
        prev, cur = steps[i - 1], steps[i]
        if prev["count"] <= 0:
            continue
        drop_pct = round(100 * (prev["count"] - cur["count"]) / prev["count"], 1)
        if worst is None or drop_pct > worst["drop_pct"]:
            worst = {
                "from_stage": prev["stage"],
                "to_stage": cur["stage"],
                "from_count": prev["count"],
                "to_count": cur["count"],
                "drop_pct": drop_pct,
            }
    return worst


@router.get("/api/internal/payment-path-diagnostics")
def payment_path_diagnostics(
    period_hours: int = 168,
    authorization: str | None = Header(default=None),
):
    """
    Read-only диагностика пути от регистрации до успешной оплаты.
    Только backend truth + минимальные ProductEvent для шагов, которые
    иначе совсем не видны (pricing_viewed, payment_cta_clicked и т.д.).
    """
    _check_auth(authorization)
    since = _period_start(period_hours)

    with database.session() as s:
        registrations = s.exec(
            select(func.count()).select_from(User).where(User.created_at >= since)
        ).one()
        channels_created = s.exec(
            select(func.count()).select_from(Channel).where(Channel.created_at >= since)
        ).one()
        post_generations = s.exec(
            select(func.count()).select_from(Post).where(Post.created_at >= since)
        ).one()

        # Разрез генераций: verified vs unverified каналы.
        # Позволяет понять, не раздувается ли post_generations автоматической
        # догенерацией очереди для каналов без подтверждённого Telegram-бота.
        # Channel.verified == True означает что бот добавлен в канал и канал
        # реально используется для публикации.
        posts_for_verified = s.exec(
            select(func.count()).select_from(Post).join(Channel, Post.channel_id == Channel.id).where(
                Post.created_at >= since, Channel.verified == True  # noqa: E712
            )
        ).one()
        posts_for_unverified = s.exec(
            select(func.count()).select_from(Post).join(Channel, Post.channel_id == Channel.id).where(
                Post.created_at >= since, Channel.verified == False  # noqa: E712
            )
        ).one()

        pricing_viewed = _count_product_event(s, "pricing_viewed", since)
        payment_cta_clicked = _count_product_event(s, "payment_cta_clicked", since)
        payment_failed_events = _count_product_event(s, "payment_failed", since)
        payment_returned = _count_product_event(s, "payment_returned", since)
        quota_warning_seen = _count_product_event(s, "quota_warning_seen", since)
        limit_reached = _count_product_event(s, "limit_reached", since)

        # Новые product events (онбординг + feedback)
        # Разбивка onboarding_choice_selected по package_id
        onboarding_generate = s.exec(
            select(func.count()).select_from(ProductEvent).where(
                ProductEvent.event == "onboarding_choice_selected",
                ProductEvent.package_id == "generate_first_post",
                ProductEvent.created_at >= since,
            )
        ).one()
        onboarding_analyze = s.exec(
            select(func.count()).select_from(ProductEvent).where(
                ProductEvent.event == "onboarding_choice_selected",
                ProductEvent.package_id == "analyze_existing_channel",
                ProductEvent.created_at >= since,
            )
        ).one()
        onboarding_skip = s.exec(
            select(func.count()).select_from(ProductEvent).where(
                ProductEvent.event == "onboarding_choice_selected",
                ProductEvent.package_id == "skip",
                ProductEvent.created_at >= since,
            )
        ).one()

        # Разбивка first_post_feedback по package_id (good / bad)
        feedback_good = s.exec(
            select(func.count()).select_from(ProductEvent).where(
                ProductEvent.event == "first_post_feedback",
                ProductEvent.package_id == "good",
                ProductEvent.created_at >= since,
            )
        ).one()
        feedback_bad = s.exec(
            select(func.count()).select_from(ProductEvent).where(
                ProductEvent.event == "first_post_feedback",
                ProductEvent.package_id == "bad",
                ProductEvent.created_at >= since,
            )
        ).one()

        # Разбивка first_post_feedback_reason по package_id
        _reason_keys = ["too_generic", "wrong_style", "wrong_topic", "too_dry", "too_salesy", "other"]
        feedback_reasons = {}
        for reason in _reason_keys:
            feedback_reasons[reason] = s.exec(
                select(func.count()).select_from(ProductEvent).where(
                    ProductEvent.event == "first_post_feedback_reason",
                    ProductEvent.package_id == reason,
                    ProductEvent.created_at >= since,
                )
            ).one()

        payment_started = s.exec(
            select(func.count()).select_from(Payment).where(Payment.created_at >= since)
        ).one()
        # ИСПРАВЛЕНО: реальный статус успешной оплаты в БД — "paid" (не "succeeded").
        # YooKassa присылает webhook с status="succeeded", но /api/yookassa/notify
        # записывает в Payment.status значение "paid" (см. main.py строки 889-890).
        payment_success = s.exec(
            select(func.count()).select_from(Payment).where(
                Payment.created_at >= since, Payment.status == "paid"
            )
        ).one()
        payment_failed_backend = s.exec(
            select(func.count()).select_from(Payment).where(
                Payment.created_at >= since, Payment.status == "failed"
            )
        ).one()
        payment_pending = s.exec(
            select(func.count()).select_from(Payment).where(
                Payment.created_at >= since, Payment.status == "pending"
            )
        ).one()

        # Attribution: разбивка ключевых метрик по источнику трафика.
        # Перед запуском Telegram Ads -- чтобы не слить telegram_ads и
        # yandex_direct в общие цифры.
        source_breakdown = _source_breakdown(s, since)

    counts = {
        "registrations": registrations,
        "channels_created": channels_created,
        "post_generations": post_generations,
        "pricing_viewed": pricing_viewed,
        "payment_cta_clicked": payment_cta_clicked,
        "payment_started": payment_started,
        "payment_success": payment_success,
    }
    steps = _conversion_steps(counts)
    dropoff = _biggest_dropoff(steps)

    missing_data = []
    if pricing_viewed == 0 and registrations > 0:
        missing_data.append(
            "pricing_viewed = 0 при наличии регистраций. Либо никто не открывал тарифы, "
            "либо событие ещё не накопилось (добавлено этим патчем -- проверьте что фронт обновлён)."
        )
    if payment_cta_clicked == 0 and pricing_viewed > 0:
        missing_data.append(
            "payment_cta_clicked = 0 при pricing_viewed > 0. Люди открывают тарифы, но не кликают "
            "'Выбрать' ни на одном пакете -- это сигнал к тарифному экрану/ценам, не к платёжному провайдеру."
        )
    if payment_started > 0 and payment_success == 0 and payment_failed_backend == 0 and payment_pending > 0:
        missing_data.append(
            f"Есть {payment_pending} Payment в статусе pending без paid/failed за период. "
            "Либо пользователь не довёл оплату до конца, либо webhook YooKassa не дошёл -- "
            "проверьте YOOKASSA webhook настройки и /api/yookassa/notify."
        )

    likely_explanation = None
    if dropoff:
        if dropoff["from_stage"] == "post_generations" and dropoff["to_stage"] == "pricing_viewed":
            likely_explanation = "Пользователи генерируют посты, но не открывают тарифы вообще -- проблема до тарифного экрана (мотивация платить/CTA на тарифы)."
        elif dropoff["from_stage"] == "pricing_viewed" and dropoff["to_stage"] == "payment_cta_clicked":
            likely_explanation = "Пользователи открывают тарифы, но не кликают оплату -- проблема в самом тарифном экране (цена, формулировки, доверие)."
        elif dropoff["from_stage"] == "payment_cta_clicked" and dropoff["to_stage"] == "payment_started":
            likely_explanation = "Клик по оплате есть, но backend Payment не создаётся -- техническая проблема в /api/billing/buy или конфигурации YooKassa."
        elif dropoff["from_stage"] == "payment_started" and dropoff["to_stage"] == "payment_success":
            likely_explanation = "Payment создаётся, но не доходит до успешной оплаты -- проблема на стороне YooKassa/webhook, либо пользователи не завершают оплату на странице провайдера."

    return {
        "period_hours": period_hours,
        "as_of": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "registrations": registrations,
        "channels_created": channels_created,
        "post_generations": post_generations,
        # Разрез генераций: для понимания не раздуваются ли числа автоматикой.
        # for_verified_channels — посты для каналов с подключённым ботом (реальное использование).
        # for_unverified_channels — онбординг / черновики / брошенные каналы без бота.
        "post_generations_breakdown": {
            "for_verified_channels": posts_for_verified,
            "for_unverified_channels": posts_for_unverified,
        },
        # Плоские алиасы для Growth Agent (совместимость с _EXPECTED_FIELDS)
        "post_generations_verified": posts_for_verified,
        "post_generations_unverified": posts_for_unverified,
        "pricing_viewed": pricing_viewed,
        "payment_cta_clicked": payment_cta_clicked,
        "payment_started": payment_started,
        "payment_success": payment_success,
        "payment_failed_backend": payment_failed_backend,
        "payment_failed_events": payment_failed_events,
        "payment_pending": payment_pending,
        "payment_returned": payment_returned,
        "quota_warning_seen": quota_warning_seen,
        "limit_reached": limit_reached,
        # Онбординг: разбивка по выборам
        "onboarding_choice_counts": {
            "generate_first_post": onboarding_generate,
            "analyze_existing_channel": onboarding_analyze,
            "skip": onboarding_skip,
        },
        # Feedback по первому посту
        "first_post_feedback_good": feedback_good,
        "first_post_feedback_bad": feedback_bad,
        "first_post_feedback_reasons": feedback_reasons,
        # Attribution: разбивка по источнику трафика (см. attribution.py,
        # TrafficAttribution). Перед запуском Telegram Ads -- основной
        # инструмент чтобы не слить telegram_ads и yandex_direct в общие
        # цифры. Источники без атрибуции (старые юзеры, organic) попадают
        # в "unknown" -- это нормально, см. задачу по attribution tracking.
        "source_breakdown": source_breakdown,
        "conversion_steps": steps,
        "biggest_dropoff": dropoff,
        "likely_explanation": likely_explanation,
        "missing_data": missing_data,
        "event_map": EVENT_MAP,
        "data_sources": {
            "backend_db": "User, Channel, Post, Payment -- прямой backend-факт",
            "product_events": "ProductEvent (pricing_viewed, payment_cta_clicked, payment_failed, payment_returned, quota_warning_seen, limit_reached, onboarding_choice_selected, first_post_feedback, first_post_feedback_reason) -- диагностика",
            "payment_success_status": "Payment.status == 'paid' (не 'succeeded' -- webhook записывает 'paid' в нашу БД)",
            "traffic_attribution": "TrafficAttribution (source/medium/campaign/content) -- источник трафика по UTM (веб) или /start параметру (Telegram), см. source_breakdown. Пользователи без записи считаются 'unknown'.",
            "not_included": "Клики/показы из рекламных кабинетов (eLama для Telegram Ads, Yandex Direct API) -- этот endpoint считает только события AutoPost после перехода/регистрации, не рекламную статистику.",
        },
    }
