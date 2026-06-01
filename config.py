"""
Конфигурация приложения. Всё читается из переменных окружения.
Эти переменные ты задаёшь один раз в Railway → Variables.
"""

import os
import json

# Локально подхватываем .env (на Railway переменные приходят из окружения).
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# ── Безопасность ──────────────────────────────────────────────
# Случайная строка для подписи токенов сессии. Сгенерируется автоматически,
# но лучше задать свою в Railway (любые 40+ случайных символов).
SECRET_KEY = os.getenv("SECRET_KEY", "change-me-please-set-a-long-random-string-in-railway")

# ── Claude (Anthropic) ────────────────────────────────────────
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")

# Цена модели за миллион токенов (для информации / расчёта себестоимости), USD
PRICE_INPUT_PER_M = float(os.getenv("PRICE_INPUT_PER_M", "3"))
PRICE_OUTPUT_PER_M = float(os.getenv("PRICE_OUTPUT_PER_M", "15"))

# ── Telegram ──────────────────────────────────────────────────
# Токен ОДНОГО бота платформы (от @BotFather).
# Его все пользователи добавляют админом в свои каналы.
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
# Username бота без @ — показываем пользователю, кого добавлять в канал.
TELEGRAM_BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "")

# ── База данных ───────────────────────────────────────────────
# Railway Postgres задаёт DATABASE_URL автоматически.
# Если её нет — используется локальный файл SQLite (для разработки).
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./postbot.db")

# ── ЮMoney ────────────────────────────────────────────────────
# Номер твоего кошелька ЮMoney (куда приходят деньги).
YOOMONEY_WALLET = os.getenv("YOOMONEY_WALLET", "")
# Секретное слово из настроек HTTP-уведомлений ЮMoney.
YOOMONEY_NOTIFICATION_SECRET = os.getenv("YOOMONEY_NOTIFICATION_SECRET", "")

# ── Публичный адрес приложения ────────────────────────────────
# Railway даёт его автоматически в RAILWAY_PUBLIC_DOMAIN.
PUBLIC_URL = os.getenv("PUBLIC_URL") or (
    f"https://{os.getenv('RAILWAY_PUBLIC_DOMAIN')}" if os.getenv("RAILWAY_PUBLIC_DOMAIN") else "http://localhost:8000"
)

# ── Тарифы (пакеты токенов) ───────────────────────────────────
# Сколько токенов даём за сколько рублей. Можешь переопределить через
# переменную TOKEN_PACKAGES (JSON). Цена за токены — это твоя наценка/бизнес.
_DEFAULT_PACKAGES = [
    {"id": "p1", "title": "Старт",   "rub": 199,  "tokens": 200_000},
    {"id": "p2", "title": "Базовый", "rub": 499,  "tokens": 600_000},
    {"id": "p3", "title": "Про",     "rub": 990,  "tokens": 1_500_000},
    {"id": "p4", "title": "Бизнес",  "rub": 2490, "tokens": 5_000_000},
]
try:
    TOKEN_PACKAGES = json.loads(os.getenv("TOKEN_PACKAGES", "")) or _DEFAULT_PACKAGES
except Exception:
    TOKEN_PACKAGES = _DEFAULT_PACKAGES

# Сколько токенов дарим новому пользователю на пробу.
WELCOME_TOKENS = int(os.getenv("WELCOME_TOKENS", "30000"))

# Как часто планировщик проверяет каналы (секунды).
TICK_SECONDS = int(os.getenv("TICK_SECONDS", "60"))


def package_by_id(pid: str):
    for p in TOKEN_PACKAGES:
        if p["id"] == pid:
            return p
    return None
