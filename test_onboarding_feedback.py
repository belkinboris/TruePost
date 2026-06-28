"""
Тесты для:
1. onboarding_choice_selected (generate_first_post / analyze_existing_channel / skip)
2. first_post_feedback (good / bad)
3. first_post_feedback_reason (too_generic / wrong_style / wrong_topic / too_dry / too_salesy / other)
4. payment_success считается по Payment.status == "paid" (не "succeeded")
5. Старые события не сломались

Тот же формат что test_payment_path_diagnostics.py — реальный HTTP к запущенному серверу.

Запуск (порт свободен, DATABASE_URL и TRUEPOST_INTERNAL_API_TOKEN выставлены):

    DATABASE_URL=sqlite:///test_ob.db TRUEPOST_INTERNAL_API_TOKEN=test-token \\
        python3 -m uvicorn main:app --port 8303 --log-level error &
    sleep 2
    BASE_URL=http://localhost:8303 TRUEPOST_INTERNAL_API_TOKEN=test-token \\
        python3 test_onboarding_feedback.py

Или одной командой через make/bash (см. README):
    DATABASE_URL=sqlite:///test_ob.db TRUEPOST_INTERNAL_API_TOKEN=test-token BASE_URL=http://localhost:8303 \\
        python3 -m pytest test_onboarding_feedback.py -v  # если pytest установлен
"""

import asyncio
import os

import httpx

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000")
INTERNAL_TOKEN = os.environ.get("TRUEPOST_INTERNAL_API_TOKEN", "test-token")

_counter = 0


def _email(prefix: str) -> str:
    global _counter
    _counter += 1
    return f"{prefix}_{_counter}@ob.test"


async def _register(client: httpx.AsyncClient, email: str) -> str:
    r = await client.post(f"{BASE_URL}/api/register", json={"email": email, "password": "test12345"})
    r.raise_for_status()
    return r.json()["token"]


async def _diag(client: httpx.AsyncClient) -> dict:
    r = await client.get(
        f"{BASE_URL}/api/internal/payment-path-diagnostics",
        headers={"Authorization": f"Bearer {INTERNAL_TOKEN}"},
    )
    r.raise_for_status()
    return r.json()


# ── 1. onboarding_choice_selected: generate_first_post ────────────────────

async def test_onboarding_choice_generate_is_accepted(client):
    token = await _register(client, _email("ob_gen"))
    r = await client.post(
        f"{BASE_URL}/api/product-event",
        json={"event": "onboarding_choice_selected", "package_id": "generate_first_post"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    assert r.json()["ok"] is True, "generate_first_post choice должен быть принят"
    print("  onboarding_choice_selected (generate_first_post): принят ✓")


# ── 2. onboarding_choice_selected: analyze_existing_channel ───────────────

async def test_onboarding_choice_analyze_is_accepted(client):
    token = await _register(client, _email("ob_analyze"))
    r = await client.post(
        f"{BASE_URL}/api/product-event",
        json={"event": "onboarding_choice_selected", "package_id": "analyze_existing_channel"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True, "analyze_existing_channel choice должен быть принят"
    print("  onboarding_choice_selected (analyze_existing_channel): принят ✓")


# ── 3. onboarding_choice_selected: skip ───────────────────────────────────

async def test_onboarding_choice_skip_is_accepted(client):
    token = await _register(client, _email("ob_skip"))
    r = await client.post(
        f"{BASE_URL}/api/product-event",
        json={"event": "onboarding_choice_selected", "package_id": "skip"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True, "skip choice должен быть принят"
    print("  onboarding_choice_selected (skip): принят ✓")


# ── 4. После skip onboarding не показывается снова (флаг в localStorage) ──
# Это frontend-поведение, тестируемое вручную — здесь только проверяем
# что backend принимает событие 'skip', остальное в ручном QA.

async def test_skip_event_persists_without_error(client):
    """
    Backend-часть: skip-событие принимается без ошибки.
    Frontend-часть (localStorage.setItem, renderDashboard проверяет флаг) —
    проверяется вручную: зарегистрировать, нажать Пропустить, перезагрузить
    страницу, убедиться что quick start не показывается снова.
    """
    token = await _register(client, _email("ob_skip_persist"))
    r = await client.post(
        f"{BASE_URL}/api/product-event",
        json={"event": "onboarding_choice_selected", "package_id": "skip"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.json()["ok"] is True
    # Нет side-effect в БД для skip — только логирование. ok=True достаточно.
    print("  skip: backend-сторона принимает без ошибки ✓ (frontend-флаг — ручной QA)")


# ── 5. first_post_feedback: good ──────────────────────────────────────────

async def test_first_post_feedback_good(client):
    token = await _register(client, _email("fb_good"))
    r = await client.post(
        f"{BASE_URL}/api/product-event",
        json={"event": "first_post_feedback", "package_id": "good"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True, "first_post_feedback good должен быть принят"
    print("  first_post_feedback (good): принят ✓")


# ── 6. first_post_feedback: bad ───────────────────────────────────────────

async def test_first_post_feedback_bad(client):
    token = await _register(client, _email("fb_bad"))
    r = await client.post(
        f"{BASE_URL}/api/product-event",
        json={"event": "first_post_feedback", "package_id": "bad"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True, "first_post_feedback bad должен быть принят"
    print("  first_post_feedback (bad): принят ✓")


# ── 7. first_post_feedback_reason: все варианты ───────────────────────────

async def test_first_post_feedback_reason_all_values(client):
    reasons = ["too_generic", "wrong_style", "wrong_topic", "too_dry", "too_salesy", "other"]
    for reason in reasons:
        token = await _register(client, _email(f"fb_reason_{reason}"))
        r = await client.post(
            f"{BASE_URL}/api/product-event",
            json={"event": "first_post_feedback_reason", "package_id": reason},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, f"Expected 200 for reason={reason}, got {r.status_code}"
        assert r.json()["ok"] is True, f"first_post_feedback_reason '{reason}' должен быть принят"
    print(f"  first_post_feedback_reason ({', '.join(reasons)}): все приняты ✓")


# ── 8. payment_success считается по Payment.status == "paid" ──────────────

async def test_payment_success_counted_by_paid_status(client):
    """
    Создаём Payment напрямую в БД со status="paid" и проверяем что
    payment-path diagnostics его видит в payment_success.

    Через публичный API Payment создаётся только через YooKassa (которой нет
    в тестовой среде). Поэтому используем прямую запись в БД — это допустимо
    в тестовом контексте, т.к. задача проверить SQL-запрос, а не биллинг-поток.
    """
    import database
    from database import Payment, User
    from sqlmodel import select

    token = await _register(client, _email("pay_paid"))

    # Достаём user_id из токена через /api/me
    me_r = await client.get(f"{BASE_URL}/api/me", headers={"Authorization": f"Bearer {token}"})
    me_r.raise_for_status()
    user_id = me_r.json()["id"]

    # Пишем Payment.status="paid" прямо в тестовую БД
    with database.session() as s:
        pay = Payment(
            user_id=user_id,
            package_id="p1",
            label="test-paid-label",
            rub=990.0,
            tokens=1_200_000,
            status="paid",
        )
        s.add(pay)
        s.commit()

    diag = await _diag(client)
    assert diag["payment_success"] >= 1, (
        f"payment_success должен быть >=1 при Payment.status='paid', "
        f"получили {diag['payment_success']}. "
        "Возможно diagnostics всё ещё ищет 'succeeded' вместо 'paid'."
    )
    print(f"  payment_success по status='paid': {diag['payment_success']} ✓")

    # Убеждаемся что 'succeeded' НЕ считается (регрессионная защита)
    with database.session() as s:
        pay_succ = Payment(
            user_id=user_id,
            package_id="p1",
            label="test-succeeded-label",
            rub=990.0,
            tokens=1_200_000,
            status="succeeded",  # намеренно неправильный статус для нашей БД
        )
        s.add(pay_succ)
        s.commit()

    diag2 = await _diag(client)
    # payment_success должен НЕ измениться — 'succeeded' не считается
    assert diag2["payment_success"] == diag["payment_success"], (
        f"Payment.status='succeeded' не должен считаться в payment_success, "
        f"но счётчик вырос с {diag['payment_success']} до {diag2['payment_success']}."
    )
    print(f"  Payment.status='succeeded' не считается (только 'paid'): ✓")


# ── 9. Старые события не сломались ────────────────────────────────────────

async def test_legacy_events_still_work(client):
    token = await _register(client, _email("legacy"))
    headers = {"Authorization": f"Bearer {token}"}
    legacy = [
        ("pricing_viewed", ""),
        ("payment_cta_clicked", "p1"),
        ("payment_failed", "p1"),
        ("payment_returned", ""),
        ("quota_warning_seen", ""),
        ("limit_reached", ""),
    ]
    for event, pkg in legacy:
        r = await client.post(
            f"{BASE_URL}/api/product-event",
            json={"event": event, "package_id": pkg},
            headers=headers,
        )
        assert r.status_code == 200, f"Expected 200 for {event}"
        assert r.json()["ok"] is True, f"Событие {event} должно быть принято"
    print(f"  legacy events ({', '.join(e for e,_ in legacy)}): все приняты ✓")


# ── Runner ─────────────────────────────────────────────────────────────────

async def main():
    print(f"\nБаза: {os.environ.get('DATABASE_URL','sqlite:///./postbot.db')}")
    print(f"Сервер: {BASE_URL}\n")

    tests = [
        test_onboarding_choice_generate_is_accepted,
        test_onboarding_choice_analyze_is_accepted,
        test_onboarding_choice_skip_is_accepted,
        test_skip_event_persists_without_error,
        test_first_post_feedback_good,
        test_first_post_feedback_bad,
        test_first_post_feedback_reason_all_values,
        test_payment_success_counted_by_paid_status,
        test_legacy_events_still_work,
    ]

    passed = 0
    failed = 0
    async with httpx.AsyncClient(timeout=15.0) as client:
        for test in tests:
            name = test.__name__
            try:
                await test(client)
                passed += 1
            except Exception as e:
                print(f"  FAIL {name}: {e}")
                failed += 1

    print(f"\n{'='*50}")
    print(f"Результат: {passed} прошли, {failed} упали")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
