"""
Тесты для эксперимента commercial_bridge (SPEC_TRUEPOST_QUEUE_OFFER):
блок «Собрать очередь на неделю» после good feedback.

Запуск:

    DATABASE_URL=sqlite:///test_qo.db TRUEPOST_INTERNAL_API_TOKEN=test-token SECRET_KEY=testsecret \\
        python3 -m uvicorn main:app --port 8307 --log-level error &
    sleep 3
    BASE_URL=http://localhost:8307 TRUEPOST_INTERNAL_API_TOKEN=test-token \\
        python3 test_queue_offer.py
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
    return f"{prefix}_{_counter}@qo.test".lower()


async def _register(client: httpx.AsyncClient, email: str) -> str:
    r = await client.post(f"{BASE_URL}/api/register", json={"email": email, "password": "test12345"})
    r.raise_for_status()
    return r.json()["token"]


# ── 1. queue_offer_shown принимается product-event endpoint ─────────────────

async def test_queue_offer_shown_accepted(client):
    token = await _register(client, _email("qo_shown"))
    r = await client.post(
        f"{BASE_URL}/api/product-event",
        json={"event": "queue_offer_shown", "package_id": ""},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True, "queue_offer_shown должен быть принят"
    print("  queue_offer_shown: принят ✓")


# ── 2. queue_offer_clicked принимается product-event endpoint ───────────────

async def test_queue_offer_clicked_accepted(client):
    token = await _register(client, _email("qo_clicked"))
    r = await client.post(
        f"{BASE_URL}/api/product-event",
        json={"event": "queue_offer_clicked", "package_id": ""},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True, "queue_offer_clicked должен быть принят"
    print("  queue_offer_clicked: принят ✓")


# ── 3. Агрегаты появляются в payment-path diagnostics ──────────────────────

async def test_queue_offer_in_diagnostics(client):
    r = await client.get(
        f"{BASE_URL}/api/internal/payment-path-diagnostics",
        headers={"Authorization": f"Bearer {INTERNAL_TOKEN}"},
    )
    r.raise_for_status()
    d = r.json()
    assert "queue_offer_shown" in d, "queue_offer_shown должен быть в diagnostics"
    assert "queue_offer_clicked" in d, "queue_offer_clicked должен быть в diagnostics"
    assert d["queue_offer_shown"] >= 1, "Счётчик queue_offer_shown должен учитывать событие из теста 1"
    assert d["queue_offer_clicked"] >= 1, "Счётчик queue_offer_clicked должен учитывать событие из теста 2"
    print(f"  diagnostics: queue_offer_shown={d['queue_offer_shown']}, queue_offer_clicked={d['queue_offer_clicked']} ✓")


# ── 4. good feedback -> в коде фронта появляется блок (статическая проверка) ─

def test_frontend_shows_queue_offer_after_good():
    """
    JS не исполняем -- проверяем статически что fpFeedbackGood рендерит блок
    queue_offer_block, логирует queue_offer_shown, и что queueOfferClick
    логирует queue_offer_clicked и ведёт на billing (экран тарифов).
    """
    with open("static/app.js") as f:
        src = f.read()

    fn_start = src.index("function fpFeedbackGood")
    fn_end = src.index("function fpFeedbackBad")
    body = src[fn_start:fn_end]

    assert "queue_offer_block" in body, "fpFeedbackGood должен рендерить queue_offer_block"
    assert 'logProductEvent("queue_offer_shown")' in body, "fpFeedbackGood должен логировать queue_offer_shown"
    assert "Соберём очередь на неделю?" in body, "Заголовок блока из SPEC"
    assert "queueOfferClick" in body, "Кнопка должна вызывать queueOfferClick"

    assert 'logProductEvent("queue_offer_clicked")' in src, "queueOfferClick должен логировать queue_offer_clicked"
    click_start = src.index("function queueOfferClick")
    click_body = src[click_start:click_start + 300]
    assert 'go("billing")' in click_body, "queueOfferClick должен вести на экран тарифов (billing)"
    print("  frontend: good feedback -> блок queue_offer + события + переход на тарифы ✓")


# ── 5. Регрессия: старые onboarding/feedback события не сломаны ────────────

async def test_regression_old_feedback_events(client):
    token = await _register(client, _email("qo_regress"))
    headers = {"Authorization": f"Bearer {token}"}
    for event, pkg in [
        ("first_post_feedback", "good"),
        ("first_post_feedback", "bad"),
        ("first_post_feedback_reason", "too_generic"),
        ("onboarding_choice_selected", "skip"),
        ("pricing_viewed", ""),
    ]:
        r = await client.post(
            f"{BASE_URL}/api/product-event",
            json={"event": event, "package_id": pkg},
            headers=headers,
        )
        assert r.status_code == 200 and r.json()["ok"] is True, f"Регрессия: {event} должен работать"
    print("  регрессия: старые события feedback/onboarding/pricing работают ✓")


# ── Runner ───────────────────────────────────────────────────────────────

async def main():
    print(f"\nБаза: {os.environ.get('DATABASE_URL', 'sqlite:///./postbot.db')}")
    print(f"Сервер: {BASE_URL}\n")

    passed = 0
    failed = 0

    try:
        test_frontend_shows_queue_offer_after_good()
        passed += 1
    except Exception as e:
        print(f"  FAIL test_frontend_shows_queue_offer_after_good: {e}")
        failed += 1

    async_tests = [
        test_queue_offer_shown_accepted,
        test_queue_offer_clicked_accepted,
        test_queue_offer_in_diagnostics,
        test_regression_old_feedback_events,
    ]
    async with httpx.AsyncClient(timeout=15.0) as client:
        for test in async_tests:
            try:
                await test(client)
                passed += 1
            except Exception as e:
                print(f"  FAIL {test.__name__}: {e}")
                failed += 1

    print(f"\n{'='*50}")
    print(f"Результат: {passed} прошли, {failed} упали")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
