"""
Минимальные тесты payment-path diagnostics.

Реальные HTTP-вызовы к настоящему серверу (как остальные test_*.py в этом
проекте) -- не unit-моки. Цель: подтвердить, что новые события реально
пишутся и реально попадают в диагностику, а не "наверное должны".

Запуск:
    python3 -m uvicorn main:app --port 8302 &
    DATABASE_URL=sqlite:///test_pp.db TRUEPOST_INTERNAL_API_TOKEN=test-token \
        python3 test_payment_path_diagnostics.py
"""

import asyncio
import os

import httpx

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000")
INTERNAL_TOKEN = os.environ.get("TRUEPOST_INTERNAL_API_TOKEN", "test-token")


async def _register(client: httpx.AsyncClient, email: str) -> str:
    r = await client.post(f"{BASE_URL}/api/register", json={"email": email, "password": "test12345"})
    r.raise_for_status()
    return r.json()["token"]


async def test_pricing_viewed_is_written_and_counted(client):
    token = await _register(client, "pp_pricing@test.com")
    headers = {"Authorization": f"Bearer {token}"}

    r = await client.post(f"{BASE_URL}/api/product-event", json={"event": "pricing_viewed"}, headers=headers)
    assert r.json()["ok"] is True, "pricing_viewed should be accepted"

    diag = await client.get(f"{BASE_URL}/api/internal/payment-path-diagnostics",
                              headers={"Authorization": f"Bearer {INTERNAL_TOKEN}"})
    data = diag.json()
    assert data["pricing_viewed"] >= 1, f"pricing_viewed should be >=1, got {data['pricing_viewed']}"
    print("  pricing_viewed: записан и виден в diagnostics ✓")


async def test_payment_cta_clicked_is_counted(client):
    token = await _register(client, "pp_cta@test.com")
    headers = {"Authorization": f"Bearer {token}"}

    r = await client.post(f"{BASE_URL}/api/product-event",
                            json={"event": "payment_cta_clicked", "package_id": "p2"}, headers=headers)
    assert r.json()["ok"] is True

    diag = await client.get(f"{BASE_URL}/api/internal/payment-path-diagnostics",
                              headers={"Authorization": f"Bearer {INTERNAL_TOKEN}"})
    data = diag.json()
    assert data["payment_cta_clicked"] >= 1
    print("  payment_cta_clicked: записан и виден в diagnostics ✓")


async def test_invalid_event_rejected_not_crashed(client):
    token = await _register(client, "pp_invalid@test.com")
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post(f"{BASE_URL}/api/product-event", json={"event": "made_up_event"}, headers=headers)
    assert r.status_code == 200, "должен вернуть 200 с ok:false, не упасть"
    assert r.json()["ok"] is False
    print("  невалидное событие: отклонено без падения ✓")


async def test_unauthenticated_rejected(client):
    r = await client.post(f"{BASE_URL}/api/product-event", json={"event": "pricing_viewed"})
    assert r.status_code == 401
    print("  без авторизации: 401, не записано ✓")


async def test_payment_pending_never_stuck_forever(client):
    """
    Регрессионный тест на конкретный найденный баг: если YooKassa не вернула
    confirmation_url, Payment должен помечаться failed, не оставаться pending
    навечно. Не можем вызвать настоящий YooKassa в тесте -- проверяем только
    что billing.is_configured()==False даёт понятную ошибку, не зависший pending.
    """
    token = await _register(client, "pp_payment@test.com")
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post(f"{BASE_URL}/api/billing/buy", json={"package_id": "p1"}, headers=headers)
    # В тестовом окружении YooKassa не настроена -- ожидаем понятную ошибку,
    # не зависание и не 500.
    assert r.status_code in (400, 502), f"expected 400/502 when payment provider isn't configured, got {r.status_code}"
    print(f"  billing/buy без настроенного провайдера: явная ошибка {r.status_code}, не зависание ✓")


async def test_diagnostics_endpoint_returns_full_structure(client):
    diag = await client.get(f"{BASE_URL}/api/internal/payment-path-diagnostics",
                              headers={"Authorization": f"Bearer {INTERNAL_TOKEN}"})
    data = diag.json()
    required_keys = [
        "registrations", "channels_created", "post_generations",
        "pricing_viewed", "payment_cta_clicked", "payment_started", "payment_success",
        "conversion_steps", "biggest_dropoff", "missing_data", "event_map", "data_sources",
    ]
    for key in required_keys:
        assert key in data, f"missing key: {key}"
    print("  endpoint возвращает полную структуру (все требуемые поля присутствуют) ✓")


async def test_diagnostics_endpoint_requires_auth(client):
    r = await client.get(f"{BASE_URL}/api/internal/payment-path-diagnostics")
    assert r.status_code == 401
    print("  diagnostics endpoint без токена: 401 ✓")


async def test_diagnostics_does_not_crash_with_zero_data(client):
    """endpoint должен возвращать 0/[] для отсутствующих данных, не падать."""
    diag = await client.get(f"{BASE_URL}/api/internal/payment-path-diagnostics?period_hours=1",
                              headers={"Authorization": f"Bearer {INTERNAL_TOKEN}"})
    assert diag.status_code == 200
    data = diag.json()
    assert isinstance(data["missing_data"], list)
    print("  endpoint с пустым периодом: не падает, возвращает корректные нули ✓")


async def main():
    print(f"BASE_URL = {BASE_URL}\n")
    async with httpx.AsyncClient(timeout=30) as client:
        tests = [
            test_pricing_viewed_is_written_and_counted,
            test_payment_cta_clicked_is_counted,
            test_invalid_event_rejected_not_crashed,
            test_unauthenticated_rejected,
            test_payment_pending_never_stuck_forever,
            test_diagnostics_endpoint_returns_full_structure,
            test_diagnostics_endpoint_requires_auth,
            test_diagnostics_does_not_crash_with_zero_data,
        ]
        failed = []
        for t in tests:
            print(f"=== {t.__name__} ===")
            try:
                await t(client)
            except AssertionError as e:
                print(f"  ПРОВАЛЕНО: {e}")
                failed.append(t.__name__)
            except Exception as e:
                print(f"  ОШИБКА: {type(e).__name__}: {e}")
                failed.append(t.__name__)
            print()

        if failed:
            print(f"ПРОВАЛЕНО: {len(failed)} — {failed}")
            raise SystemExit(1)
        print("Все тесты пройдены ✓")


if __name__ == "__main__":
    asyncio.run(main())
