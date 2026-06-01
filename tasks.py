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
