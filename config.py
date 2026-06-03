"""Конфигурация из переменных окружения."""

import os, json

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

SECRET_KEY = os.getenv("SECRET_KEY", "change-me-set-long-random-string")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./postbot.db")
YOOMONEY_WALLET = os.getenv("YOOMONEY_WALLET", "")
YOOMONEY_NOTIFICATION_SECRET = os.getenv("YOOMONEY_NOTIFICATION_SECRET", "")
PUBLIC_URL = os.getenv("PUBLIC_URL") or (
    f"https://{os.getenv('RAILWAY_PUBLIC_DOMAIN')}"
    if os.getenv("RAILWAY_PUBLIC_DOMAIN") else "http://localhost:8000"
)

# Токенов в подарок новому пользователю
WELCOME_TOKENS = int(os.getenv("WELCOME_TOKENS", "30000"))
# Бонус за реферала (обоим)
REFERRAL_BONUS_TOKENS = int(os.getenv("REFERRAL_BONUS_TOKENS", "50000"))

TICK_SECONDS = int(os.getenv("TICK_SECONDS", "60"))

# ── Планы подписки ────────────────────────────────────────────────
# Лимит постов в месяц. 0 = безлимит.
PLANS = {
    "free":     {"title": "Бесплатно",  "rub": 0,    "channels": 1, "posts_per_month": 10},
    "starter":  {"title": "Старт",      "rub": 490,  "channels": 1, "posts_per_month": 90},
    "pro":      {"title": "Про",        "rub": 990,  "channels": 3, "posts_per_month": 300},
    "business": {"title": "Бизнес",     "rub": 2490, "channels": 10,"posts_per_month": 1500},
    "agency":   {"title": "Агентство",  "rub": 4990, "channels": 0, "posts_per_month": 5000},
}

# Токены для внутреннего учёта (покупка через ЮMoney, если используем)
_DEFAULT_PACKAGES = [
    {"id": "p1", "title": "Старт",    "rub": 490,  "tokens": 500_000},
    {"id": "p2", "title": "Про",      "rub": 990,  "tokens": 1_200_000},
    {"id": "p3", "title": "Бизнес",   "rub": 2490, "tokens": 4_000_000},
    {"id": "p4", "title": "Агентство","rub": 4990, "tokens": 10_000_000},
]
try:
    TOKEN_PACKAGES = json.loads(os.getenv("TOKEN_PACKAGES", "")) or _DEFAULT_PACKAGES
except Exception:
    TOKEN_PACKAGES = _DEFAULT_PACKAGES


def package_by_id(pid: str):
    for p in TOKEN_PACKAGES:
        if p["id"] == pid:
            return p
    return None
