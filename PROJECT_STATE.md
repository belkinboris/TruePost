# PROJECT_STATE

**Last updated:** 2026-06-30
**Current production status:** Attribution tracking реализован и протестирован end-to-end (26/26 тестов проходят, включая регрессионные). Готов к деплою перед запуском Telegram Ads.
**Current priority:** Задеплоить attribution tracking. После деплоя — прогнать оба проверочных сценария из задачи на реальном проде (UTM-ссылка на лендинг + /start у бота), затем можно запускать Telegram Ads.
**Do not touch now:** Direct bids, Direct budget, тарифы/цены, free quota, лендинг-тексты, реклама, UX, payment logic, product funnel logic.
**Next task:** 1) Деплой. 2) Открыть `https://autopost26.up.railway.app/landing?utm_source=telegram_ads&utm_medium=cpc&utm_campaign=test&utm_content=test_ad`, пройти лендинг → регистрацию → создание канала → генерацию, проверить `source_breakdown.telegram_ads` в diagnostics. 3) То же для `https://t.me/maintrpost_bot?start=tgads_test_testad`. 4) После подтверждения обоих сценариев — можно запускать Telegram Ads.

---

## 1. AutoPost Core Product

**Scope:** registration/login; onboarding; first post generation; Telegram channel connection; publication; queue; autopublishing; settings; tariffs; delete account.

**Done:**
- Quick start onboarding с экраном выбора («Что сделать сначала?»), feedback-блок под первым постом.
- Topic validation, post-topic match check, идемпотентность quick start.
- Нормализация Telegram username/ссылки.
- Публикация: idempotent, reconciliation.
- Удаление канала и аккаунта: пошаговое.
- Free quota 200k токенов.
- `qsSkip()` сохраняет флаг в localStorage.
- **НОВОЕ (2026-06-30):** `AuthIn` (schemas.py) расширен полем `utm_content`. Форма регистрации в app.js теперь передаёт `utm_content` вместе с остальными UTM при наличии `lp_session`.

**Tested:**
- Полный quick start flow, DELETE endpoints, новые ProductEvent — все ранее пройденные тесты.
- **НОВОЕ:** `test_attribution.py` — 9 тестов, все прошли через реальный HTTP-сервер.

**Open:**
- DELETE /api/me — не подтверждён на реальном ранее падавшем аккаунте (BUG-005).
- «Сессия истекла» при неверном пароле (BUG-001).
- Auth state inconsistency после hard reload (BUG-002).
- Landing → web app load 15-20 секунд (BUG-003).
- Over-blocking медицинских/образовательных тем (BUG-004).

**Do not touch:** generator.py, voice/format/emoji маппинги.

---

## 2. AutoPost Landing

**Done:**
- CTA/Journey Diagnostics: `landing_session_id`, UTM/yclid проброс через `LandingEvent`.
- **НОВОЕ (2026-06-30):** `landing.html` теперь читает и прокидывает `utm_content` (наряду с source/medium/campaign) во всех трёх местах: `getUTM()`, `logLandingEvent()` payload, и query string при переходе на SPA (`goCTA` для destination != 'bot').
- **НОВОЕ:** При `landing_view` с `utm_source` пишется запись в `TrafficAttribution` (без `user_id`, привязка происходит позже при регистрации по `session_id`).

**Open:**
- Landing → web app переход 15-20 секунд — инструментирован, причина не определена.

**Do not touch:** Текст и позиционирование лендинга.

---

## 3. Growth Agent / Аналитик роста

**Done (предыдущие сессии):**
- `ProductEvent` таблица, `payment-path-diagnostics`, исправление `succeeded`→`paid`, allowlist расширен (onboarding_choice_selected, first_post_feedback, first_post_feedback_reason), агрегаты feedback/onboarding в diagnostics.

**Done (НОВОЕ, 2026-06-30 — attribution tracking):**
- **Новая таблица `TrafficAttribution`** (database.py): `id, user_id (nullable, indexed), landing_session_id (nullable, indexed), source, medium, campaign, content, raw_start_param, created_at`. Создаётся через `create_all()`, без ALTER TABLE на существующих таблицах.
- **Новый модуль `attribution.py`**: чистые функции `classify_utm(utm_source, utm_medium)` и `classify_start_param(raw)` — без побочных эффектов, юнит-тестируемые отдельно от HTTP.
  - `classify_utm`: 'telegram'/'tgads' → telegram_ads; 'yandex'/'direct' → yandex_direct; иначе как есть; пусто → unknown.
  - `classify_start_param`: `tgads_<campaign>_<content>` → telegram_ads/cpc; `lp_*` и `u<id>` явно НЕ источники трафика (другая семантика, не путаются); иначе unknown.
- **`/api/register` (main.py)**: при наличии `utm_source` — классифицирует и пишет `TrafficAttribution` с `user_id`. При наличии только `lp_session` (без UTM, путь от Telegram-бота) — ищет существующую запись `TrafficAttribution` без `user_id` по тому же `landing_session_id` и привязывает её (не создаёт дубль).
- **`/api/landing-event` (main.py)**: при первом событии `landing_view` с `utm_source` — пишет `TrafficAttribution` без `user_id` (привязка произойдёт при регистрации). `_LandingEventIn` расширен полем `utm_content`.
- **`_process_main_bot_updates` (tasks.py)**: при `/start <param>` парсит параметр через `classify_start_param`. Если распознан как `telegram_ads` — генерирует `lp_session` вида `tg{chat_id}_{timestamp}`, пишет `TrafficAttribution` (без `user_id`), и встраивает `lp_session` в URL кнопки Mini App (`?lp_session=...`), чтобы веб-часть подхватила её и регистрация привязалась к той же записи.
- **`source_breakdown` в payment-path diagnostics** (internal_payment_path.py): агрегаты `registrations, channels_created, post_generations, pricing_viewed, payment_cta_clicked, payment_started, payment_success` по `telegram_ads / yandex_direct / direct / unknown / other`. Вычисляется через `_source_breakdown(s, since)` — join по `user_id` без дополнительных SQL JOIN'ов (Python-side группировка после загрузки списков id).
- Старые пользователи без `TrafficAttribution` записи автоматически попадают в `unknown` — ожидаемое поведение, не баг.

**Tested:**
- `test_attribution.py` (9 тестов): UTM telegram_ads/yandex_direct сохраняются при регистрации, регистрация без UTM → unknown, симуляция /start tgads_* → привязка к user_id без дублей, структура `source_breakdown`, регрессия всех 23 старых полей diagnostics, регрессия 6 старых ProductEvent.
- Полный регрессионный прогон: `test_payment_path_diagnostics.py` (8) + `test_onboarding_feedback.py` (9) + `test_attribution.py` (9) = **26/26 тестов прошли**.
- End-to-end ручная проверка через реальный HTTP-сервер: регистрация с `utm_source=telegram_ads&utm_content=test_ad` → `source_breakdown.telegram_ads.registrations` корректно увеличивается; регистрация без UTM → `unknown` увеличивается.

**Open:**
- Проверить оба сценария на **реальном проде** после деплоя (см. Next task выше).
- Ротация `TRUEPOST_INTERNAL_API_TOKEN` (засвечен ранее) — отложена, ждёт своей очереди.

**PowerShell для проверки source_breakdown на проде:**
```powershell
Invoke-RestMethod -Uri "https://autopost26.up.railway.app/api/internal/payment-path-diagnostics?period_hours=168" -Method Get -Headers @{"Authorization" = "Bearer YOUR_TOKEN_HERE"} | ConvertTo-Json -Depth 10
```

**Пример `source_breakdown` в ответе:**
```json
"source_breakdown": {
  "telegram_ads":   {"registrations": 12, "channels_created": 4, "post_generations": 9, "pricing_viewed": 3, "payment_cta_clicked": 1, "payment_started": 1, "payment_success": 0},
  "yandex_direct":  {"registrations": 38, "channels_created": 15, "post_generations": 60, "pricing_viewed": 11, "payment_cta_clicked": 5, "payment_started": 4, "payment_success": 2},
  "direct":         {"registrations": 0, "channels_created": 0, "post_generations": 0, "pricing_viewed": 0, "payment_cta_clicked": 0, "payment_started": 0, "payment_success": 0},
  "unknown":        {"registrations": 145, "channels_created": 50, "post_generations": 200, "pricing_viewed": 30, "payment_cta_clicked": 8, "payment_started": 6, "payment_success": 3},
  "other":          {"registrations": 0, "channels_created": 0, "post_generations": 0, "pricing_viewed": 0, "payment_cta_clicked": 0, "payment_started": 0, "payment_success": 0}
}
```
(`unknown` исторически большой -- это все регистрации ДО внедрения attribution tracking, ожидаемо.)

**Do not touch:** Direct bids, Direct budget, Telegram Ads attribution **логика классификации** (рекламные кампании сами не менялись, только инфраструктура для их различения).

---

## 4. Product Observer / QA Agent

**Тесты:**
- `test_quickstart_flow.py`, `test_topic_validation.py`
- `test_payment_path_diagnostics.py` (8 тестов)
- `test_onboarding_feedback.py` (9 тестов)
- **НОВОЕ:** `test_attribution.py` (9 тестов)

**Команда полного прогона:**
```bash
DATABASE_URL=sqlite:///test_full.db TRUEPOST_INTERNAL_API_TOKEN=test-token SECRET_KEY=testsecret \
    python3 -m uvicorn main:app --port 8400 --log-level error &
sleep 3
BASE_URL=http://localhost:8400 TRUEPOST_INTERNAL_API_TOKEN=test-token python3 test_payment_path_diagnostics.py
BASE_URL=http://localhost:8400 TRUEPOST_INTERNAL_API_TOKEN=test-token python3 test_onboarding_feedback.py
BASE_URL=http://localhost:8400 TRUEPOST_INTERNAL_API_TOKEN=test-token python3 test_attribution.py
```

---

## 5. AI Office / Future Concept

Не затрагивалось.

---

## 6. Shared Infrastructure

**Done:**
- `ProductEvent`, `IdempotencyKey`, `LandingEvent` — новые таблицы (старые).
- **НОВОЕ (2026-06-30):** `TrafficAttribution` — новая таблица (та же безопасная схема: `create_all()`, без ALTER TABLE, `user_id` без FK constraint чтобы не ломать удаление аккаунта).
- `App._onboardingSkipped` через localStorage.

**Decisions (не пересматривать):**
- Не использовать `ALTER TABLE` на существующих таблицах. Новая логика — только через новые таблицы. **Подтверждено снова в этой сессии** для `TrafficAttribution`.
- Локальные тесты с FK: явно включать `PRAGMA foreign_keys=ON`.
- Подключение канала и публикация — два явных разделённых шага.
- Все backend-ошибки нормализуются на русский язык.
- **НОВОЕ:** Классификация источника трафика — чистые функции в отдельном модуле `attribution.py`, без побочных эффектов, легко юнит-тестируются отдельно от HTTP-слоя.
- **НОВОЕ:** `lp_session` (Telegram-путь) и `utm_source` (веб-путь) — разные механизмы привязки к `TrafficAttribution`, но сходятся в одной записи через `landing_session_id`, чтобы не плодить дубли при заходе и с лендинга, и из бота.

---

## 7. Open Bugs

### BUG-001 / «Сессия истекла» при неверном пароле — P1, Open
### BUG-002 / Auth state inconsistency после hard reload — P1, Open
### BUG-003 / Landing → web app load 15-20 секунд — P1, Open
### BUG-004 / Over-blocking сексологических/медицинских тем — P2, Open
### BUG-005 / DELETE /api/me — финальное подтверждение — P0, Fix задеплоен, ожидает подтверждения

---

## 8. Recently Fixed

**Date:** 2026-06-30
**Area:** Growth Agent / Attribution tracking перед Telegram Ads
**Changed:**
- Новая таблица `TrafficAttribution` (database.py).
- Новый модуль `attribution.py` с `classify_utm()` и `classify_start_param()`.
- `/api/register` — пишет/привязывает TrafficAttribution.
- `/api/landing-event` — пишет TrafficAttribution на `landing_view` с UTM, добавлено поле `utm_content`.
- `_process_main_bot_updates` (tasks.py) — парсит `/start tgads_*`, пишет TrafficAttribution, прокидывает `lp_session` в URL Mini App кнопки.
- `internal_payment_path.py` — добавлена функция `_source_breakdown()`, поле `source_breakdown` в ответе diagnostics.
- `schemas.py` (`AuthIn`) — добавлено поле `utm_content`.
- `static/app.js` и `static/landing.html` — `utm_content` подхватывается и прокидывается по всей цепочке лендинг → SPA → register.
**Retested:** 9 новых тестов (`test_attribution.py`) + полный регрессионный прогон 26/26 (включая `test_payment_path_diagnostics.py` и `test_onboarding_feedback.py`) — все прошли через реальный HTTP-сервер. Ручная end-to-end проверка обоих сценариев (UTM на лендинге, симуляция /start tgads_*) подтверждена через curl против живого сервера.
**Result:** Готово к деплою. Финальная проверка на реальном проде — следующий шаг.

---

**Date:** 2026-06-29
**Area:** Core Product / Onboarding UX + Growth Agent / payment-path diagnostics
**Changed:** Onboarding choice screen, feedback-блок, post_generations_breakdown, payment_success fix (succeeded→paid), allowlist расширен.
**Retested:** 9 тестов (test_onboarding_feedback.py).

---

**Date:** 2026-06-28
**Area:** Growth Agent / Диагностика 401 на payment-path-diagnostics
**Changed:** Код не менялся, проблема была в PowerShell-команде.

---

## 9. Decisions

**Date:** 2026-06-30
**Decision:** Источник трафика хранится в отдельной таблице `TrafficAttribution`, не добавляется как колонка в `User`.
**Reason:** Не трогать существующую схему User (ALTER TABLE запрещён по существующему решению), плюс позволяет хранить несколько точек захвата атрибуции без конфликтов.

**Date:** 2026-06-30
**Decision:** `lp_session` и `utm_source` — разные пути привязки, но всегда сходятся через `landing_session_id`, чтобы не создавать дублирующие записи на одного пользователя.
**Reason:** Telegram-путь (`/start`) не имеет доступа к UTM, только к start-параметру; веб-путь имеет полноценные UTM. Оба должны давать одинаковый результат в diagnostics.

**Date:** 2026-06-30
**Decision:** Старые пользователи (зарегистрированные до этой сессии) и пользователи без определённого источника — `unknown`, не `null`/ошибка.
**Reason:** Явно зафиксировано в задаче как ожидаемое поведение, не баг.

**Date:** 2026-06-29
**Decision:** Новые product events используют существующее поле `package_id`, не создают новых колонок.
**Date:** 2026-06-22
**Decision:** Не использовать ALTER TABLE на существующих таблицах. Тесты с FK — явный PRAGMA foreign_keys=ON. Подключение канала и публикация — два явных шага. Backend-ошибки на русском.
