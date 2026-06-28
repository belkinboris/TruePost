# PROJECT_STATE

**Last updated:** 2026-06-29
**Current production status:** Стабилизация + продуктовая диагностика. Добавлен onboarding choice screen, feedback по первому посту, разрез генераций verified/unverified, исправлен баг payment_success (succeeded→paid).
**Current priority:** Задеплоить изменения этой сессии. После деплоя: подтвердить `/api/internal/payment-path-diagnostics` на проде (PowerShell-команда ниже), затем ротация TRUEPOST_INTERNAL_API_TOKEN.
**Do not touch now:** Direct bids, Direct budget, тарифы/цены, free quota, лендинг, Telegram Ads attribution, generator.py, voice/format/emoji маппинги.
**Next task:** 1) Деплой. 2) Подтвердить endpoint на проде. 3) Ротация токена. 4) Через ~7 дней: прочитать ProductEvent — какой onboarding_choice выбирают пользователи, каков first_post_feedback.

---

## 1. AutoPost Core Product

**Scope:** registration/login; onboarding; first post generation; Telegram channel connection; publication; queue; autopublishing; settings; tariffs; delete account.

**Done:**
- Quick start onboarding: тема → генерация первого поста → отдельный экран подключения канала → отдельный экран подтверждения публикации.
- Topic validation отдельным эндпоинтом `POST /api/validate-topic` до создания канала.
- Post-topic match check после генерации.
- Идемпотентность quick start через `client_request_id` + таблица `IdempotencyKey`.
- Нормализация Telegram username/ссылки.
- Карточки постов: один главный статус-индикатор.
- Публикация: idempotent, reconciliation через `GET /posts/{id}/status`.
- Удаление канала и аккаунта: пошаговое, с логированием.
- Free quota 200k токенов.
- **НОВОЕ (2026-06-29):** Экран выбора в начале quick start («Что сделать сначала?»).
- **НОВОЕ (2026-06-29):** Feedback-блок под первым постом («Пост подходит? Да / Не совсем»).
- **НОВОЕ (2026-06-29):** `qsSkip()` теперь сохраняет флаг в `localStorage` — онбординг не показывается повторно после перезагрузки.

**Tested:**
- Полный quick start flow — `test_quickstart_flow.py`.
- DELETE /api/channels/{id} и DELETE /api/me — с `PRAGMA foreign_keys=ON`.
- Новые события allowlist + payment_success fix — `test_onboarding_feedback.py` (9 тестов, синтаксис и smoke tests прошли локально; full HTTP run — после деплоя).

**Open:**
- DELETE /api/me — не подтверждён на реальном ранее падавшем аккаунте (BUG-005).
- «Сессия истекла» при неверном пароле (BUG-001).
- Auth state inconsistency после hard reload (BUG-002).
- Landing → web app load 15-20 секунд (BUG-003).
- Over-blocking медицинских/образовательных тем (BUG-004).

**Risks:**
- `auto_publish_without_review` — нужна финальная сверка согласованности логики.
- Topic-classification добавляет 2 вызова Claude API на каждую генерацию — юнит-экономика не пересчитана.

**Do not touch:** generator.py, voice/format/emoji маппинги в generator.py.

---

## 2. AutoPost Landing

**Done:**
- CTA/Journey Diagnostics: `landing_session_id`, UTM/yclid проброс, события через `LandingEvent`.
- Дедупликация событий.

**Open:**
- Landing → web app переход 15-20 секунд — инструментирован, причина не определена.

**Do not touch:** Текст и позиционирование лендинга.

---

## 3. Growth Agent / Аналитик роста

**Done (сессия 2026-06-28/29):**
- Таблица `ProductEvent` (id, event, user_id nullable, package_id, created_at).
- `POST /api/product-event` — логирование событий.
- `GET /api/internal/payment-path-diagnostics?period_hours=168` — полная диагностика payment path.
- **ИСПРАВЛЕНО (2026-06-29):** `payment_success` теперь считается по `Payment.status == "paid"` (было `"succeeded"` — баг: реальный статус в БД всегда `"paid"`, webhook пишет именно его, см. main.py строки 889-890).
- **НОВОЕ (2026-06-29):** Разрез генераций в diagnostics:
  ```json
  "post_generations_breakdown": {
    "for_verified_channels": N,
    "for_unverified_channels": N
  }
  ```
  Позволяет увидеть, не раздувает ли автоочередь метрику post_generations.
- **НОВОЕ (2026-06-29):** Allowlist расширен: `onboarding_choice_selected`, `first_post_feedback`, `first_post_feedback_reason`.

**Allowlist (полный):**
```
pricing_viewed
payment_cta_clicked
payment_failed
payment_returned
quota_warning_seen
limit_reached
onboarding_choice_selected   # package_id: generate_first_post / analyze_existing_channel / skip
first_post_feedback          # package_id: good / bad
first_post_feedback_reason   # package_id: too_generic / wrong_style / wrong_topic / too_dry / too_salesy / other
```

**PowerShell команда для проверки на проде (одна строка):**
```powershell
Invoke-RestMethod -Uri "https://autopost26.up.railway.app/api/internal/payment-path-diagnostics?period_hours=168" -Method Get -Headers @{"Authorization" = "Bearer YOUR_TOKEN_HERE"}
```

**Ожидаемые поля в ответе:** `registrations`, `channels_created`, `post_generations`, `post_generations_breakdown`, `pricing_viewed`, `payment_cta_clicked`, `payment_started`, `payment_success`, `payment_failed_backend`, `payment_failed_events`, `payment_pending`, `payment_returned`, `quota_warning_seen`, `limit_reached`, `conversion_steps`, `biggest_dropoff`, `likely_explanation`, `missing_data`, `event_map`.

**Open:**
- Подтвердить endpoint на реальном проде после деплоя.
- Ротация `TRUEPOST_INTERNAL_API_TOKEN` (токен был засвечен на фото).

**Do not touch:** Direct bids, Direct budget, Telegram Ads attribution.

---

## 4. Product Observer / QA Agent

**Status:** Не реализован как агент. Покрыт тестами:
- `test_quickstart_flow.py`
- `test_topic_validation.py`
- `test_payment_path_diagnostics.py` (8 тестов)
- `test_onboarding_feedback.py` (9 тестов) — **НОВОЕ 2026-06-29**

**Команда запуска:**
```bash
DATABASE_URL=sqlite:///test_ob.db TRUEPOST_INTERNAL_API_TOKEN=test-token SECRET_KEY=testsecret \
    python3 -m uvicorn main:app --port 8303 --log-level error &
sleep 3
BASE_URL=http://localhost:8303 TRUEPOST_INTERNAL_API_TOKEN=test-token \
    python3 test_onboarding_feedback.py
# Старые:
BASE_URL=http://localhost:8303 TRUEPOST_INTERNAL_API_TOKEN=test-token \
    python3 test_payment_path_diagnostics.py
```

---

## 5. AI Office / Future Concept

Не затрагивалось. Future concept only.

---

## 6. Shared Infrastructure

**Done:**
- Централизованная нормализация ошибок на фронте и backend.
- `boot()` не стирает токен при сетевой ошибке.
- `publish_post` правильный порядок + BackgroundTasks.
- `IdempotencyKey` таблица.
- `delete_channel` / `delete_account` — пошаговая транзакционная модель.
- `ProductEvent` таблица.
- `/api/internal/schema-diagnostics`.
- **НОВОЕ (2026-06-29):** `App._onboardingSkipped` читается из `localStorage` при инициализации — флаг переживает перезагрузку страницы.

**Open:**
- Полная Postgres-схема не подтверждена через `/api/internal/schema-diagnostics`.
- BackgroundTasks: поведение при редеплое не исследовано.

**Decisions (не пересматривать):**
- Не использовать `ALTER TABLE` на существующих таблицах.
- Локальные тесты с FK: явно включать `PRAGMA foreign_keys=ON`.
- Подключение канала и публикация — два явных разделённых шага.
- Все backend-ошибки нормализуются на русский язык.

---

## 7. Open Bugs

### BUG-001 / «Сессия истекла» при неверном пароле
**Priority:** P1 | **Status:** Open

### BUG-002 / Auth state inconsistency после hard reload
**Priority:** P1 | **Status:** Open

### BUG-003 / Landing → web app load 15-20 секунд
**Priority:** P1 | **Status:** Open, инструментирован

### BUG-004 / Over-blocking сексологических/медицинских тем
**Priority:** P2 | **Status:** Open

### BUG-005 / DELETE /api/me — финальное подтверждение
**Priority:** P0 | **Status:** Fix задеплоен, ожидает подтверждения на реальном аккаунте

---

## 8. Recently Fixed

**Date:** 2026-06-29
**Area:** Core Product / Onboarding UX (app.js)
**Changed:**
- `renderQuickStart()` теперь показывает экран выбора («Что сделать сначала?») перед экраном с textarea темы.
- Новые функции: `qsChooseGenerate()`, `qsChooseAnalyze()`, `qsAnalyzeSubmit()`, `renderQuickStartGenerate(prefillTopic)`.
- Выбор «Проанализировать канал» запрашивает @username и передаёт его как prefill в поле темы — безопасный первый шаг без обещаний полноценного анализа.
- `qsSkip()` сохраняет флаг в `localStorage("ap_onboarding_skipped")`, `App._onboardingSkipped` читается из него при инициализации — переживает перезагрузку.
- `renderFirstPostResult()` добавлен feedback-блок («Пост подходит? Да / Не совсем»). Кнопка «Подключить канал» появляется только после ответа на feedback.
- Новые функции: `fpFeedbackGood()`, `fpFeedbackBad()`, `fpFeedbackReason(reason)`.
**Retested:** Синтаксис JS (node), синтаксис Python (ast.parse), наличие всех функций и строк — проверены. Full HTTP run — после деплоя.

---

**Date:** 2026-06-29
**Area:** Growth Agent / payment-path diagnostics (internal_payment_path.py)
**Changed:**
- `Payment.status == "succeeded"` → `Payment.status == "paid"` (реальный статус в БД).
- Добавлен разрез генераций по `Channel.verified`: `posts_for_verified` / `posts_for_unverified`.
- Поле `post_generations_breakdown` в ответе diagnostics.
- Обновлены `event_map`, `missing_data` текст, `data_sources`.
**Retested:** Smoke test на SQLite подтвердил: `paid=1` считается, `succeeded=1` — нет.

---

**Date:** 2026-06-29
**Area:** Growth Agent / ProductEvent allowlist (main.py)
**Changed:** `_ALLOWED_PRODUCT_EVENTS` расширен: `onboarding_choice_selected`, `first_post_feedback`, `first_post_feedback_reason`.
**Retested:** Python ast.parse OK, allowlist-check скриптом — все 9 событий присутствуют.

---

**Date:** 2026-06-28
**Area:** Growth Agent / Диагностика 401 на payment-path-diagnostics
**Changed:** Код не менялся. Проблема — синтаксис PowerShell. Правильная команда задокументирована выше.

---

**Date:** 2026-06-22
**Area:** Core Product / Account deletion, Auth, Onboarding, Publication
**Changed:** Порядок очистки IdempotencyKey, auth 401 handling, publish_post BackgroundTasks, topic validation, post-topic match.
**Result:** Локально исправлено. BUG-005 ожидает подтверждения на проде.

---

## 9. Decisions

**Date:** 2026-06-29
**Decision:** Новые product events (onboarding, feedback) используют существующее поле `package_id` для хранения значения (generate_first_post, good, too_generic и т.д.), не создают новых колонок в БД.
**Reason:** Схема ProductEvent уже позволяет это (package_id — строка до 20 символов). Добавление колонки потребовало бы ALTER TABLE или новой миграции.

**Date:** 2026-06-29
**Decision:** Кнопка «Подключить Telegram-канал» после первого поста показывается только после ответа на feedback (hidden → visible), но без hard paywall — пользователь не блокируется.
**Reason:** Нужно понять качество поста до следующего шага, но не требовать оплату до понимания ценности.

**Date:** 2026-06-22
**Decision:** Не использовать ALTER TABLE на существующих таблицах. Новая логика — через новые таблицы.
**Decision:** Тесты с FK — явный PRAGMA foreign_keys=ON.
**Decision:** Подключение канала и публикация — два явных шага.
**Decision:** Все backend-ошибки нормализуются на русский язык.
