"""
Биллинг через YooKassa.

Поток оплаты:
  1. Пользователь выбирает пакет токенов — создаём локальный Payment(status=pending).
  2. Создаём платёж YooKassa через API /v3/payments.
  3. Отдаём пользователю confirmation_url для оплаты.
  4. YooKassa присылает webhook на /api/yookassa/notify.
  5. Для защиты от поддельных уведомлений повторно запрашиваем платёж в API YooKassa
     и начисляем токены только если статус платежа актуально succeeded, а paid == true.
"""

import logging
import uuid
from typing import Any

import httpx

import config

logger = logging.getLogger(__name__)

YOOKASSA_PAYMENTS_URL = "https://api.yookassa.ru/v3/payments"


class YooKassaError(RuntimeError):
    """Ошибка при обращении к YooKassa."""


def is_configured() -> bool:
    return bool(config.YOOKASSA_SHOP_ID and config.YOOKASSA_SECRET_KEY)


def _auth() -> tuple[str, str]:
    return (config.YOOKASSA_SHOP_ID, config.YOOKASSA_SECRET_KEY)


def _amount(value: float | int) -> dict[str, str]:
    return {"value": f"{float(value):.2f}", "currency": "RUB"}


def _receipt(description: str, amount_rub: float, user_email: str | None) -> dict[str, Any] | None:
    """
    Опциональный чек для тех магазинов YooKassa, где включена фискализация.
    По умолчанию выключен, потому что настройка чеков зависит от юрлица/ИП и схемы работы магазина.
    """
    if not config.YOOKASSA_SEND_RECEIPT:
        return None
    if not user_email:
        raise YooKassaError("Для отправки чека YooKassa нужен email пользователя")

    return {
        "customer": {"email": user_email},
        "items": [
            {
                "description": description[:128],
                "quantity": "1.00",
                "amount": _amount(amount_rub),
                "vat_code": config.YOOKASSA_VAT_CODE,
                "payment_subject": "service",
                "payment_mode": "full_payment",
            }
        ],
    }


async def create_payment(
    *,
    label: str,
    amount_rub: float,
    description: str,
    user_id: int,
    package_id: str,
    user_email: str | None = None,
) -> dict[str, Any]:
    """Создаёт платёж YooKassa и возвращает объект платежа."""
    if not is_configured():
        raise YooKassaError("YooKassa не настроена: задайте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY")

    payload: dict[str, Any] = {
        "amount": _amount(amount_rub),
        "capture": True,
        "confirmation": {
            "type": "redirect",
            "return_url": config.YOOKASSA_RETURN_URL,
        },
        "description": description[:128],
        "metadata": {
            "label": label,
            "user_id": str(user_id),
            "package_id": package_id,
        },
    }

    receipt = _receipt(description, amount_rub, user_email)
    if receipt:
        payload["receipt"] = receipt

    headers = {
        "Idempotence-Key": str(uuid.uuid4()),
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            response = await client.post(
                YOOKASSA_PAYMENTS_URL,
                auth=_auth(),
                headers=headers,
                json=payload,
            )
        except httpx.HTTPError as exc:
            raise YooKassaError(f"Не удалось обратиться к YooKassa: {exc}") from exc

    if response.status_code >= 400:
        logger.warning("YooKassa create_payment error %s: %s", response.status_code, response.text)
        raise YooKassaError(_extract_error_message(response))

    data = response.json()
    confirmation_url = (data.get("confirmation") or {}).get("confirmation_url")
    if not confirmation_url:
        raise YooKassaError("YooKassa не вернула ссылку на оплату")
    return data


async def get_payment(payment_id: str) -> dict[str, Any]:
    """Получает актуальный статус платежа из YooKassa."""
    if not is_configured():
        raise YooKassaError("YooKassa не настроена")
    if not payment_id:
        raise YooKassaError("Не передан payment_id")

    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            response = await client.get(f"{YOOKASSA_PAYMENTS_URL}/{payment_id}", auth=_auth())
        except httpx.HTTPError as exc:
            raise YooKassaError(f"Не удалось проверить платёж в YooKassa: {exc}") from exc

    if response.status_code >= 400:
        logger.warning("YooKassa get_payment error %s: %s", response.status_code, response.text)
        raise YooKassaError(_extract_error_message(response))

    return response.json()


def _extract_error_message(response: httpx.Response) -> str:
    try:
        data = response.json()
    except Exception:
        return f"Ошибка YooKassa: HTTP {response.status_code}"

    description = data.get("description") or data.get("parameter") or data.get("code")
    if description:
        return f"Ошибка YooKassa: {description}"
    return f"Ошибка YooKassa: HTTP {response.status_code}"
