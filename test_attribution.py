"""
Тесты для attribution tracking (TrafficAttribution) перед запуском Telegram Ads.

Запуск:

    DATABASE_URL=sqlite:///test_attr.db TRUEPOST_INTERNAL_API_TOKEN=test-token SECRET_KEY=testsecret \\
        python3 -m uvicorn main:app --port 8305 --log-level error &
    sleep 3
    BASE_URL=http://localhost:8305 TRUEPOST_INTERNAL_API_TOKEN=test-token \\
        python3 test_attribution.py
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
    return f"{prefix}_{_counter}@attr.test"


async def _register(client: httpx.AsyncClient, email: str, **extra) -> dict:
    payload = {"email": email, "password": "test12345", **extra}
    r = await client.post(f"{BASE_URL}/api/register", json=payload)
    r.raise_for_status()
    return r.json()


async def _diag(client: httpx.AsyncClient) -> dict:
    r = await client.get(
        f"{BASE_URL}/api/internal/payment-path-diagnostics",
        headers={"Authorization": f"Bearer {INTERNAL_TOKEN}"},
    )
    r.raise_for_status()
    return r.json()


# ── 0. classify_utm / classify_start_param (pure unit tests, no server) ───

def test_classify_utm_unit():
    from attribution import classify_utm

    assert classify_utm("telegram_ads", "cpc") == ("telegram_ads", "cpc")
    assert classify_utm("yandex", "cpc") == ("yandex_direct", "cpc")
    assert classify_utm("", "") == ("unknown", "unknown")
    print("  classify_utm: unit-тесты прошли ✓")


def test_classify_start_param_unit():
    from attribution import classify_start_param

    # Точный сценарий из задачи: /start tgads_test_testad
    assert classify_start_param("tgads_test_testad") == ("telegram_ads", "cpc", "test", "testad")
    assert classify_start_param("lp_abc123")[0] == "unknown"  # не источник, а сессия лендинга
    assert classify_start_param("u42")[0] == "unknown"  # линковка аккаунта, не источник
    print("  classify_start_param: unit-тесты прошли ✓ (включая tgads_test_testad из задачи)")


# ── 1. UTM telegram_ads сохраняется при регистрации ────────────────────────

async def test_utm_telegram_ads_saved_on_register(client):
    email = _email("utm_tg")
    await _register(
        client, email,
        lp_session="sess_" + email,
        utm_source="telegram_ads", utm_medium="cpc",
        utm_campaign="test", utm_content="test_ad",
    )
    diag = await _diag(client)
    assert diag["source_breakdown"]["telegram_ads"]["registrations"] >= 1, (
        "Регистрация с utm_source=telegram_ads должна попасть в source_breakdown.telegram_ads"
    )
    print("  UTM telegram_ads сохраняется при регистрации ✓")


# ── 2. UTM yandex сохраняется как yandex_direct ─────────────────────────────

async def test_utm_yandex_saved_as_yandex_direct(client):
    email = _email("utm_ya")
    await _register(
        client, email,
        lp_session="sess_" + email,
        utm_source="yandex", utm_medium="cpc", utm_campaign="q1",
    )
    diag = await _diag(client)
    assert diag["source_breakdown"]["yandex_direct"]["registrations"] >= 1
    print("  UTM yandex сохраняется как yandex_direct ✓")


# ── 3. Регистрация без UTM -> unknown ───────────────────────────────────────

async def test_no_utm_falls_into_unknown(client):
    before = (await _diag(client))["source_breakdown"]["unknown"]["registrations"]
    await _register(client, _email("no_utm"))
    after = (await _diag(client))["source_breakdown"]["unknown"]["registrations"]
    assert after == before + 1, (
        f"Регистрация без UTM должна увеличить unknown на 1, было {before}, стало {after}"
    )
    print("  Регистрация без UTM попадает в unknown ✓")


# ── 4. start-параметр tgads_* распознаётся как telegram_ads (через TrafficAttribution напрямую) ─

async def test_start_param_creates_attribution_without_user(client):
    """
    Симулирует то, что делает _process_main_bot_updates в tasks.py при
    /start tgads_test_testad: пишет TrafficAttribution с landing_session_id,
    БЕЗ user_id (юзера ещё нет). Затем регистрация с тем же lp_session
    должна привязать user_id к этой же записи (не создать новую).
    """
    import database
    from database import TrafficAttribution
    from sqlmodel import select

    lp_session = "tg999_simulated"
    with database.session() as s:
        s.add(TrafficAttribution(
            landing_session_id=lp_session,
            source="telegram_ads", medium="cpc",
            campaign="test", content="testad",
            raw_start_param="tgads_test_testad",
        ))
        s.commit()

    # Регистрация с тем же lp_session, БЕЗ utm_source (имитирует Mini App
    # переход по кнопке бота -- там нет UTM, только lp_session)
    email = _email("tg_start")
    await _register(client, email, lp_session=lp_session)

    with database.session() as s:
        rows = s.exec(
            select(TrafficAttribution).where(TrafficAttribution.landing_session_id == lp_session)
        ).all()
        assert len(rows) == 1, (
            f"Должна остаться ровно 1 запись TrafficAttribution на сессию (привязка user_id "
            f"к существующей записи, не создание новой), получили {len(rows)}"
        )
        assert rows[0].user_id is not None, "user_id должен быть привязан после регистрации"
        assert rows[0].source == "telegram_ads"

    print("  /start tgads_* -> TrafficAttribution привязывается к user_id при регистрации (без дублей) ✓")


# ── 5. source_breakdown появляется в diagnostics с ожидаемой структурой ────

async def test_source_breakdown_structure(client):
    diag = await _diag(client)
    assert "source_breakdown" in diag, "source_breakdown должен быть в ответе diagnostics"
    sb = diag["source_breakdown"]
    for src in ["telegram_ads", "yandex_direct", "direct", "unknown"]:
        assert src in sb, f"source_breakdown должен содержать ключ '{src}'"
        for field in ["registrations", "channels_created", "post_generations",
                       "pricing_viewed", "payment_cta_clicked", "payment_started", "payment_success"]:
            assert field in sb[src], f"source_breakdown.{src} должен содержать поле '{field}'"
    print("  source_breakdown имеет ожидаемую структуру (все источники, все поля) ✓")


# ── 6. Старые payment diagnostics поля не сломаны ───────────────────────────

async def test_legacy_diagnostics_fields_unchanged(client):
    diag = await _diag(client)
    required_legacy_fields = [
        "registrations", "channels_created", "post_generations",
        "post_generations_breakdown", "pricing_viewed", "payment_cta_clicked",
        "payment_started", "payment_success", "payment_failed_backend",
        "payment_failed_events", "payment_pending", "payment_returned",
        "quota_warning_seen", "limit_reached", "onboarding_choice_counts",
        "first_post_feedback_good", "first_post_feedback_bad",
        "first_post_feedback_reasons", "conversion_steps", "biggest_dropoff",
        "likely_explanation", "missing_data", "event_map",
    ]
    for field in required_legacy_fields:
        assert field in diag, f"Старое поле '{field}' пропало из diagnostics -- регрессия"
    print(f"  Все {len(required_legacy_fields)} старых полей diagnostics на месте ✓")


# ── 7. Старые ProductEvent не сломаны ───────────────────────────────────────

async def test_legacy_product_events_unchanged(client):
    token_data = await _register(client, _email("legacy_pe"))
    headers = {"Authorization": f"Bearer {token_data['token']}"}
    legacy = ["pricing_viewed", "payment_cta_clicked", "payment_failed",
              "payment_returned", "quota_warning_seen", "limit_reached"]
    for event in legacy:
        r = await client.post(
            f"{BASE_URL}/api/product-event",
            json={"event": event, "package_id": ""},
            headers=headers,
        )
        assert r.status_code == 200
        assert r.json()["ok"] is True, f"Legacy event {event} должен работать как раньше"
    print(f"  Старые ProductEvent ({', '.join(legacy)}) не сломаны ✓")


# ── Runner ───────────────────────────────────────────────────────────────

async def main():
    print(f"\nБаза: {os.environ.get('DATABASE_URL', 'sqlite:///./postbot.db')}")
    print(f"Сервер: {BASE_URL}\n")

    sync_tests = [test_classify_utm_unit, test_classify_start_param_unit]
    async_tests = [
        test_utm_telegram_ads_saved_on_register,
        test_utm_yandex_saved_as_yandex_direct,
        test_no_utm_falls_into_unknown,
        test_start_param_creates_attribution_without_user,
        test_source_breakdown_structure,
        test_legacy_diagnostics_fields_unchanged,
        test_legacy_product_events_unchanged,
    ]

    passed = 0
    failed = 0

    for test in sync_tests:
        try:
            test()
            passed += 1
        except Exception as e:
            print(f"  FAIL {test.__name__}: {e}")
            failed += 1

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
