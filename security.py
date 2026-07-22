"""
Безопасность без внешних библиотек:
  - пароли: PBKDF2-HMAC-SHA256 (stdlib hashlib)
  - токены сессии: подписанные HMAC-SHA256 (как JWT, но без зависимостей)
"""

import hashlib
import hmac
import os
import json
import base64
import time

import config

_ALGO = "sha256"
_ITER = 200_000


# ── ПАРОЛИ ────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac(_ALGO, password.encode(), salt, _ITER)
    return f"{salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, dk_hex = stored.split("$", 1)
        salt = bytes.fromhex(salt_hex)
        dk = hashlib.pbkdf2_hmac(_ALGO, password.encode(), salt, _ITER)
        return hmac.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False


# ── ТОКЕНЫ СЕССИИ ─────────────────────────────────────────────

def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def create_token(user_id: int, days_valid: int = 30) -> str:
    payload = {"uid": user_id, "exp": int(time.time()) + days_valid * 86400}
    body = _b64(json.dumps(payload).encode())
    sig = _b64(hmac.new(config.SECRET_KEY.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def verify_token(token: str):
    try:
        body, sig = token.split(".", 1)
        expected = _b64(hmac.new(config.SECRET_KEY.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(_unb64(body))
        if payload.get("exp", 0) < time.time():
            return None
        return payload.get("uid")
    except Exception:
        return None


# ── TELEGRAM MINI APP: проверка initData ─────────────────────
# Алгоритм из официальной документации Telegram
# (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
#   secret_key = HMAC_SHA256(key="WebAppData", data=<bot_token>)
#   hash       = HMAC_SHA256(key=secret_key,    data=<data_check_string>)
# data_check_string -- все поля initData кроме hash, отсортированные по
# ключу и склеенные как "key=value" через \n.

def verify_telegram_init_data(init_data: str, bot_token: str, max_age_seconds: int = 86400):
    """Проверяет подпись initData Telegram Mini App. При успехе возвращает
    распарсенный dict полей (поле "user" уже раскрыто из JSON), иначе None.
    max_age_seconds защищает от повторного использования старой, возможно
    утёкшей initData -- Telegram переиздаёт auth_date при каждом открытии."""
    try:
        from urllib.parse import parse_qsl
        data = dict(parse_qsl(init_data, strict_parsing=True))
        received_hash = data.pop("hash", None)
        if not received_hash:
            return None
        check_string = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
        secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
        computed_hash = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(computed_hash, received_hash):
            return None
        auth_date = int(data.get("auth_date", "0"))
        if auth_date <= 0 or (time.time() - auth_date) > max_age_seconds:
            return None
        if "user" in data:
            data["user"] = json.loads(data["user"])
        return data
    except Exception:
        return None
