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
PUBLIC_URL = os.getenv("PUBLIC_URL") or (
    f"https://{os.getenv('RAILWAY_PUBLIC_DOMAIN')}"
    if os.getenv("RAILWAY_PUBLIC_DOMAIN") else "http://localhost:8000"
)

# YooKassa API
YOOKASSA_SHOP_ID = os.getenv("YOOKASSA_SHOP_ID", "")
YOOKASSA_SECRET_KEY = os.getenv("YOOKASSA_SECRET_KEY", "")
YOOKASSA_RETURN_URL = os.getenv("YOOKASSA_RETURN_URL", f"{PUBLIC_URL}/?paid=1")
YOOKASSA_SEND_RECEIPT = os.getenv("YOOKASSA_SEND_RECEIPT", "false").lower() in {"1", "true", "yes", "on"}
YOOKASSA_VAT_CODE = int(os.getenv("YOOKASSA_VAT_CODE", "1"))  # 1 = без НДС

# Токенов в подарок новому пользователю
WELCOME_TOKENS = int(os.getenv("WELCOME_TOKENS", "111000"))  # 3 бесплатных поста
# Бонус за реферала (обоим)
REFERRAL_BONUS_TOKENS = int(os.getenv("REFERRAL_BONUS_TOKENS", "50000"))  # ~1–2 поста

TICK_SECONDS = int(os.getenv("TICK_SECONDS", "60"))

# ── Планы подписки ────────────────────────────────────────────────
# Лимит в токенах. Пост стоит 20 000–40 000 токенов в зависимости от сложности.
# Пользователю показываем ДИАПАЗОН постов: токены / 40k (мин) … токены / 20k (макс)
PLANS = {
    "free":     {"title": "Бесплатно",  "rub": 0,      "channels": 1,  "tokens": 120_000},     # 3–6 постов
    "starter":  {"title": "Старт",      "rub": 990,    "channels": 1,  "tokens": 1_200_000},   # 30–60 постов
    "pro":      {"title": "Про",        "rub": 2490,   "channels": 3,  "tokens": 3_000_000},   # 75–150 постов
    "business": {"title": "Бизнес",     "rub": 7990,   "channels": 10, "tokens": 10_000_000},  # 250–500 постов
    "agency":   {"title": "Агентство",  "rub": 14990,  "channels": 0,  "tokens": 20_000_000},  # 500–1000 постов
}

# Стоимость поста в токенах (для расчёта диапазона)
POST_TOKENS_MIN = 20_000   # простой пост
POST_TOKENS_MAX = 40_000   # сложный пост (много промптов, web_search, история)

# Токены для внутреннего учёта (покупка через YooKassa)
_DEFAULT_PACKAGES = [
    {"id": "p1", "title": "Старт",     "rub": 990,   "tokens": 1_200_000},   # 30–60 постов
    {"id": "p2", "title": "Про",       "rub": 2490,  "tokens": 3_000_000},   # 75–150 постов
    {"id": "p3", "title": "Бизнес",    "rub": 7990,  "tokens": 10_000_000},  # 250–500 постов
    {"id": "p4", "title": "Агентство", "rub": 14990, "tokens": 20_000_000},  # 500–1000 постов
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
