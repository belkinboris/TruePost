"""
Биллинг через ЮMoney.

Поток оплаты:
  1. Пользователь выбирает пакет токенов → создаём Payment(status=pending) с уникальной меткой label.
  2. Отдаём ссылку на форму оплаты ЮMoney (quickpay) с этой меткой.
  3. Пользователь платит. ЮMoney шлёт HTTP-уведомление на /api/yoomoney/notify.
  4. Проверяем подпись sha1_hash, находим Payment по label, начисляем токены.
"""

import hashlib
import logging
from urllib.parse import urlencode

import config

logger = logging.getLogger(__name__)

QUICKPAY_URL = "https://yoomoney.ru/quickpay/confirm.xml"


def build_payment_url(label: str, amount_rub: float, description: str) -> str:
    """Формирует ссылку на платёжную форму ЮMoney (quickpay)."""
    params = {
        "receiver": config.YOOMONEY_WALLET,
        "quickpay-form": "shop",
        "targets": description,
        "paymentType": "AC",          # AC = банковская карта; PC = кошелёк ЮMoney
        "sum": f"{amount_rub:.2f}",
        "label": label,
        "successURL": f"{config.PUBLIC_URL}/?paid=1",
    }
    return f"{QUICKPAY_URL}?{urlencode(params)}"


def verify_notification(form: dict) -> bool:
    """
    Проверяет подлинность HTTP-уведомления ЮMoney по sha1_hash.

    Формула (для уведомлений «Сбор денег»):
      sha1( notification_type & operation_id & amount & currency &
            datetime & sender & codepro & notification_secret & label )
    """
    if not config.YOOMONEY_NOTIFICATION_SECRET:
        logger.error("YOOMONEY_NOTIFICATION_SECRET не задан — не могу проверить платёж")
        return False

    fields = [
        form.get("notification_type", ""),
        form.get("operation_id", ""),
        form.get("amount", ""),
        form.get("currency", ""),
        form.get("datetime", ""),
        form.get("sender", ""),
        form.get("codepro", ""),
        config.YOOMONEY_NOTIFICATION_SECRET,
        form.get("label", ""),
    ]
    check_string = "&".join(fields)
    calculated = hashlib.sha1(check_string.encode("utf-8")).hexdigest()
    received = form.get("sha1_hash", "")

    ok = hashlib.sha1(check_string.encode()).hexdigest() == received
    if not ok:
        logger.warning(f"Подпись ЮMoney не совпала. Ждали {calculated}, получили {received}")
    return ok
