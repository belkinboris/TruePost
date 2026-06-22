# PROJECT_STATE

**Last updated:** 2026-06-22
**Current production status:** Стабилизация после серии P0-фиксов (auth, account deletion, onboarding). Требует подтверждения на реальных аккаунтах после деплоя.
**Current priority:** Подтвердить что DELETE /api/me реально работает на проде (acceptance test ещё не закрыт пользователем). Затем — открытые баги auth-инконсистентности и медленной загрузки.
**Do not touch now:** Direct bids, Direct budget, AI Office implementation, P2 hover styling, любой крупный редизайн не связанный с landing/onboarding.
**Next task:** Подтвердить фикс DELETE /api/me на реальном ранее падавшем аккаунте. Параллельно — разобраться с "сессия истекла" при неверном пароле и инконсистентностью auth-состояния после hard reload.

---

## 1. AutoPost Core Product

**Scope:** registration/login; onboarding; first post generation; Telegram channel connection; publication; queue; autopublishing; settings; tariffs; delete account.

**Status:**

**Done:**
- Quick start onboarding: тема → генерация первого поста → отдельный экран подключения канала → отдельный экран подтверждения публикации (подключение канала ≠ публикация, это два явных шага).
- Topic validation отдельным эндпоинтом `POST /api/validate-topic`, вызывается **до** создания канала — неподходящая/неясная тема больше не создаёт канал-черновик.
- Post-topic match check после генерации (защита от "соскальзывания" темы при web_search, P0-баг с генерацией про крипту при вводе несвязанной темы).
- Идемпотентность quick start через `client_request_id` + таблица `IdempotencyKey` — повторный клик при "Load failed" не создаёт дублирующий канал. Защита от "протёкшего" ключа: возврат старого канала только если `about` совпадает.
- Нормализация Telegram username/ссылки (`@T.me/...`, `t.me/...`, `https://t.me/...` → единый `@username`), с понятными русскими ошибками на все известные паттерны Telegram API (member list inaccessible, not enough rights, chat not found и т.д.) — централизовано, сырые ошибки Telegram больше не показываются пользователю.
- Карточки постов: один главный статус-индикатор (pending/scheduled/published/failed), вместо смешанных статусов и текста "на проверке" → "Ждёт вашего подтверждения".
- Публикация: idempotent (`already_published` при повторном вызове), reconciliation после frontend-таймаута через `GET /posts/{id}/status` вместо немедленного показа ошибки.
- Удаление канала и удаление аккаунта: пошаговое, с логированием каждого шага, корректным порядком очистки зависимых таблиц.
- `[object Object]` в toast устранено (Pydantic validation errors на фронте нормализуются в читаемый текст).
- Защита от публикации без подключённого канала (кнопка недоступна + явная проверка перед запросом).
- Free quota увеличена до 200k токенов.

**Tested:**
- Полный quick start flow (validate-topic → create channel → generate) — интеграционными тестами на реальном HTTP-сервере (`test_quickstart_flow.py`), включая P0-регрессию на adult/unclear темах.
- DELETE /api/channels/{id} и DELETE /api/me — на реальном FastAPI-сервере (не только SQLite, но и с явно включённым `PRAGMA foreign_keys=ON` для имитации Postgres-поведения), несколько раз после новых регрессий.
- Конкретный сценарий из продового лога (аккаунт с referral + idempotency key одновременно) воспроизведён и подтверждён как исправленный.

**Open:**
- DELETE /api/me — последний фикс (порядок очистки IdempotencyKey до удаления User) задеплоен, но **не подтверждён на реальном ранее падавшем аккаунте**. Это open до явного подтверждения от пользователя.
- "Сессия истекла" при вводе неверного пароля — баг, ещё не исследован.
- Auth state может становиться неконсистентным: залогиненный браузер может показать quick start, потом "не авторизован" до hard reload.
- Success screen после публикации — нужно сделать "Перейти в очередь" основной кнопкой (сейчас не приоритетная).
- Тексты о бесплатных токенах/постах не обновлены после изменения квоты до 200k — могут быть устаревшие цифры в UI.
- Темы из секс-просвещения/медицинского характера блокируются слишком агрессивно классификатором тем (over-blocking).

**Risks:**
- Topic-classification и post-topic-match добавляют 2 лишних вызова Claude API на каждую генерацию (стоимость + латентность) — не пересчитана юнит-экономика после этого изменения.
- Полный список FK на проде не подтверждён через `/api/internal/schema-diagnostics` — фикс delete_account основан на анализе кода + одном реальном логе, не на полной выгрузке схемы.
- `auto_publish_without_review` и связанная с ней логика countdown на карточках — менялась несколько раз за сессию, нужна финальная сверка что вся логика согласована (особенно "канал на паузе" + автопубликация одновременно).

**Do not touch:** Бизнес-логика генерации поста (voice/format/emoji маппинги в generator.py) — не трогалась и не должна затрагиваться следующими фиксами без явного запроса.

**Next:** Подтвердить DELETE /api/me на реальном аккаунте. Затем — auth-инконсистентность и "сессия истекла" на неверном пароле.

---

## 2. AutoPost Landing

**Scope:** hero; CTA; landing → web app transition; Telegram CTA; trust/control copy; FAQ; Metrika events.

**Status:**

**Done:**
- Landing уже позиционирован правильно ("веди канал регулярно", не "генератор текста вообще") — не требовал серьёзной правки текста.
- CTA/Journey Diagnostics: `landing_session_id`, UTM/yclid проброс, события `landing_view` / `cta_*_click` / `bot_start_from_landing` / `web_register_opened` / `register_success` логируются в `LandingEvent` и читаются через `/api/internal/landing-funnel-diagnostics`.
- Дедупликация событий (`web_register_opened`, `register_success` ранее дублировались из-за повторных вызовов `boot()`).
- Уточнена архитектура: `@maintrpost_bot` — вход в Mini App (не отдельный backend), `@Trpst_bot` — publishing bot. CTA на лендинг ведёт через `?startapp=lp_<session_id>` (Mini App start_param), не через серверный `/start`.

**Tested:**
- Funnel diagnostics эндпоинт вызван и подтверждён вживую (landing_views, cta clicks).

**Open:**
- Landing → web app переход занимает 15-20 секунд — добавлены тайминги (`console.log` на каждом этапе `boot()`), но сама причина задержки не определена и не устранена (cold start backend vs JS vs что-то ещё).
- Telegram SDK потенциально блокирует загрузку web app — не проверено.

**Risks:** Нет данных о реальной конверсии landing → registration после всех последних правок onboarding — funnel diagnostics стоит пересмотреть с свежими данными.

**Do not touch:** Текст и позиционирование лендинга — было явно сказано не трогать ("мне нравится как сейчас"), только инфраструктура диагностики менялась.

**Next:** Найти причину 15-20 секунд через тайминги которые уже стоят в коде (нужен реальный прогон с просмотром console.log/Railway логов).

---

## 3. Growth Agent / Аналитик роста

**Scope:** Yandex Direct; Yandex Metrika; /deep_direct; /check_landing; /check_onboarding; attribution; search query clusters; device reports; clean-period diagnostics.

**Status:** Эта сессия не затрагивала Growth Agent напрямую — только инфраструктуру, которую он читает (`/api/internal/metrics`, `/api/internal/landing-funnel-diagnostics`, новый `/api/internal/schema-diagnostics`).

**Done:** Внутренние diagnostic-эндпоинты (см. раздел 6) готовы к использованию Growth Agent'ом.

**Tested:** Эндпоинты вызваны вручную и возвращают корректные данные; интеграция с самим Growth Agent не проверялась в этой сессии.

**Open:** Attribution регистраций к Direct не подтверждена (со слов задачи, требует отдельной проверки Growth Agent'ом).

**Risks:** Нет.

**Do not touch:** Direct bids, Direct budget — явно вне scope текущей работы.

**Next:** Не определено в рамках этой сессии — требует отдельного захода с Growth Agent.

---

## 4. Product Observer / QA Agent

**Scope:** synthetic onboarding tests; raw error detection; timeout detection; stale topic detection; duplicate channel/post detection; publication confirmation; UI state consistency.

**Status:** Не реализован как отдельный агент. Функционально частично покрыт ручными интеграционными тестами, написанными в этой сессии (`test_quickstart_flow.py`, `test_topic_validation.py`), но это не автономный QA-агент, а одноразовые скрипты для конкретных багов.

**Done:** Тестовые сценарии для stale topic, duplicate channel (idempotency), raw error ([object Object]), publication confirmation (timeout reconciliation) — все покрыты вручную написанными тестами по конкретным P0-багам.

**Tested:** Да, см. выше — но через ручной запуск, не автоматизированный agent.

**Open:** Нет постоянного автоматического synthetic-тестирования onboarding на каждый деплой.

**Risks:** Без автономного QA-agent каждая новая регрессия (как с IdempotencyKey/referred_by) обнаруживается только постфактум на реальных аккаунтах.

**Do not touch:** Н/п — раздел не реализован.

**Next:** Не в скоупе этой сессии. Возможное направление — оформить написанные тестовые скрипты в постоянный CI/synthetic-monitoring процесс.

---

## 5. AI Office / Future Concept

**Scope:** future product idea; AI employees; positioning; living office UI; autonomy levels.

**Status:** Не затрагивалось в этой сессии.

**Important:** Это future concept only. Не должен влиять на текущий AutoPost landing или продукт.

---

## 6. Shared Infrastructure

**Scope:** auth; tokens; sessions; database; Railway; Telegram SDK; Telegram bots; Yandex APIs; logging; BackgroundTasks; idempotency; error normalization.

**Status:**

**Done:**
- `api()` на фронте: централизованная нормализация ошибок (Pydantic validation arrays, generic detail), раздельная обработка 401 для register/login vs остальных эндпоинтов (раньше любой 401 жёстко показывал "сессия истекла" даже при первой регистрации).
- `boot()`: сетевой сбой `/me` больше не стирает валидный токен — `logout()` теперь срабатывает только при подтверждённой auth-ошибке (401), не при любой ошибке сети/cold start backend.
- `publish_post`: переписан порядок — Telegram → DB commit → быстрый ответ; уведомления и автодогенерация очереди перенесены в `BackgroundTasks`, не блокируют HTTP-ответ (это была причина false timeout после успешной публикации).
- Централизованная нормализация Telegram API ошибок (`_normalize_telegram_error`, `normalize_publish_error`) с явным маппингом известных паттернов.
- `IdempotencyKey` — новая таблица (безопасно через `create_all()`, без `ALTER TABLE` на существующих таблицах).
- `delete_channel` и `delete_account` переписаны на пошаговую транзакционную модель с логированием каждого шага, разделением критичных и опциональных операций, fallback-анонимизацией для account deletion при неизвестном FK.
- Найден и исправлен реальный root cause P0-регрессии: `User.referred_by` (самоссылающийся FK) и порядок очистки `IdempotencyKey` (должна быть до удаления User, не после).
- Новый диагностический эндпоинт `/api/internal/schema-diagnostics` — опрашивает реальный Postgres `information_schema` для получения списка всех таблиц и FK, без предположений по коду.
- `correlation_id` в ошибках account deletion — для прямой привязки UI-ошибки к конкретным строкам в логах Railway.

**Tested:**
- Все фиксы публикации, удаления канала/аккаунта — на реальном FastAPI-сервере с принудительным FK enforcement (имитация Postgres-поведения на SQLite через `PRAGMA foreign_keys=ON`), не только "счастливый путь".
- Конкретный продовый сценарий (аккаунт 21: referral + idempotency key) воспроизведён точно и подтверждён как исправленный.

**Open:**
- Полная Postgres-схема прода не подтверждена напрямую (только через один реальный лог + анализ кода) — `/api/internal/schema-diagnostics` создан, но результат его вызова на реальном проде ещё не получен.
- BackgroundTasks: используется для publish_post followup — не проверено поведение при перезапуске/деплое посередине выполнения фоновой задачи (edge case, не критичный, но не исследован).

**Risks:**
- SQLite (локальная разработка/тесты) не enforces FK constraints по умолчанию — это уже один раз привело к тому что локальные тесты "проходили", а прод падал. Любой будущий тест с участием FK обязан явно включать `PRAGMA foreign_keys=ON`, иначе результат недостоверен.
- `database.py` в репозитории не гарантированно 100% совпадает с реально развёрнутой схемой на Railway (возможны ручные правки/более старые версии) — это и есть причина по которой создан `schema-diagnostics` эндпоинт.

**Do not touch:** Структура `session()`/`engine` в `database.py` — рабочая, менялась только через добавление новых таблиц, не через изменение существующих полей (за исключением одного фикса нормализации chat -- см. telegram_api.py).

**Next:** Прогнать `/api/internal/schema-diagnostics` на реальном проде, сверить с предположениями из кода.

---

## 7. Open Bugs

### BUG-001 / "Сессия истекла" при неверном пароле

**Priority:** P1
**Area:** Shared Infrastructure / Auth
**Status:** Open, не исследован
**Observed:** Пользователь вводит неверный пароль при логине, видит "сессия истекла" вместо "неверный email или пароль".
**Expected:** Понятная ошибка именно про неверные данные входа, не про истёкшую сессию.
**Evidence:** Со слов задачи (initial content), не воспроизведено отдельным тестом в этой сессии.
**Next action:** Проверить `/api/login` и фронтовый `authBtn.onclick` — скорее всего тот же класс проблемы что был с register (401 due to wrong credentials must not trigger the same generic "session expired" branch).

---

### BUG-002 / Auth state inconsistency после hard reload

**Priority:** P1
**Area:** Shared Infrastructure / Auth, Frontend state
**Status:** Open, не исследован
**Observed:** Залогиненный браузер может показать quick start, затем "не авторизован" до hard reload.
**Expected:** Консистентное auth-состояние без необходимости hard reload.
**Evidence:** Со слов задачи, не воспроизведено отдельно.
**Next action:** Проверить race condition между `boot()` и любыми другими вызовами `api()`, которые могут сработать до того как `App.token`/`App.user` полностью инициализированы.

---

### BUG-003 / Landing → web app load 15-20 секунд

**Priority:** P1
**Area:** Landing, Shared Infrastructure
**Status:** Open, инструментирован но не диагностирован
**Observed:** Переход с лендинга в веб-приложение занимает 15-20 секунд.
**Expected:** Быстрая загрузка, видимый skeleton вместо пустого экрана.
**Evidence:** Тайминги добавлены в `boot()` (`console.log` на каждом этапе) и статический skeleton в `index.html` — но сама причина задержки (cold start backend / Telegram SDK / JS) не определена.
**Next action:** Прогнать реальную загрузку и посмотреть на тайминги в консоли браузера + логи Railway за тот же период.

---

### BUG-004 / Over-blocking сексологических/медицинских тем

**Priority:** P2
**Area:** Core Product / Topic validation
**Status:** Open
**Observed:** Темы из секс-просвещения или медицинского характера блокируются классификатором как unsafe/adult, хотя могут быть легитимным контентом.
**Expected:** Более точная грань между откровенно неприемлемым контентом и нейтральными образовательными/медицинскими темами.
**Evidence:** Со слов задачи.
**Next action:** Пересмотреть промпт `_TOPIC_CLASSIFY_SYSTEM` в `generator.py` — возможно нужны явные примеры медицинских/образовательных тем как `valid_topic`.

---

### BUG-005 / DELETE /api/me — финальное подтверждение на реальном аккаунте

**Priority:** P0
**Area:** Core Product / Account deletion
**Status:** Fix задеплоен, ожидает подтверждения
**Observed:** Ранее падало с `ForeignKeyViolation` на `idempotencykey_user_id_fkey` (см. Recently Fixed). Порядок очистки исправлен.
**Expected:** Аккаунт удаляется успешно через реальный UI на ранее падавшем аккаунте.
**Evidence:** Реальный лог Railway с `IntegrityError`, воспроизведён локально с `PRAGMA foreign_keys=ON`, фикс подтверждён тем же тестом.
**Next action:** Дождаться подтверждения от пользователя на реальном проде (acceptance criterion из задачи: "this is not closed until it passes on the real previously failing Railway account").

---

## 8. Recently Fixed

**Date:** 2026-06-22
**Area:** Core Product / Account deletion (DELETE /api/me)
**Changed:** Порядок очистки `IdempotencyKey` перенесён до удаления `User` (был после — вызывал `ForeignKeyViolation` на проде). Очистка теперь по `user_id` (реальный constraint), не только `channel_id`.
**Retested:** Да — на реальном FastAPI-сервере с `PRAGMA foreign_keys=ON`, включая точный сценарий из продового лога (referral + idempotency key).
**Result:** Исправлено локально с высокой уверенностью, ожидает финального подтверждения на проде.
**Risk:** Если на проде есть другие неучтённые FK — потребуется повторная диагностика через `/api/internal/schema-diagnostics`.

---

**Date:** 2026-06-22
**Area:** Core Product / Account deletion — первая попытка (до находки реальной причины)
**Changed:** `User.referred_by` (самоссылающийся FK) — добавлено обнуление у приглашённых пользователей перед удалением реферера. Добавлен fallback (анонимизация через существующие поля) и пошаговое логирование с `correlation_id`.
**Retested:** Да, локально с FK enforcement.
**Result:** Этот фикс был верным, но недостаточным — настоящая причина (IdempotencyKey порядок) была найдена только после реального лога Railway, см. выше.
**Risk:** Нет, фикс остаётся в силе и дополняет финальное решение.

---

**Date:** 2026-06-22
**Area:** Shared Infrastructure / Auth
**Changed:** Раздельная обработка 401 для register/login vs остальных запросов. `boot()` больше не стирает токен при сетевой ошибке `/me` (только при подтверждённом 401).
**Retested:** Да, через реальный HTTP-сервер (регистрация) + изолированный JS-тест (сценарий сетевого сбоя vs настоящий 401).
**Result:** P0-блокер регистрации устранён.
**Risk:** Не покрывает BUG-001 (неверный пароль) и BUG-002 (auth inconsistency) — это отдельные, ещё открытые проблемы того же раздела.

---

**Date:** 2026-06-22
**Area:** Core Product / Onboarding
**Changed:** Topic validation перенесена на отдельный pre-create эндпоинт; добавлена post-topic match check; найден и исправлен root cause "генерация про крипту при вводе несвязанной темы" (тема не передавалась явно в user-сообщение модели при web_search).
**Retested:** Да, интеграционными тестами полного flow.
**Result:** P0 stale-topic баг устранён на уровне известных сценариев.
**Risk:** Стоимость генерации увеличилась (доп. вызовы классификации) — не пересчитана.

---

**Date:** 2026-06-22
**Area:** Core Product / Publication
**Changed:** `publish_post` переписан с правильным порядком (Telegram → DB → быстрый ответ), followup-операции в BackgroundTasks. Идемпотентность публикации. Frontend reconciliation через polling статуса после ложного timeout.
**Retested:** Да.
**Result:** False timeout после успешной публикации устранён.
**Risk:** Нет выявленных.

---

## 9. Decisions

**Date:** 2026-06-22
**Decision:** Не использовать `ALTER TABLE` на существующих продовых таблицах (`User`, `Channel`, `Post` и т.д.) ни при каких обстоятельствах в рамках текущей итерации.
**Reason:** Прямой риск для продовой Postgres БД без контролируемой миграции. Любая новая бизнес-логика, требующая нового поля, реализуется через отдельную новую таблицу (паттерн `LandingEvent`, `IdempotencyKey`).
**Do not revisit unless:** Появится отдельная, осознанная задача на миграцию схемы с явным планом rollback.

---

**Date:** 2026-06-22
**Decision:** Локальные тесты на SQLite должны явно включать `PRAGMA foreign_keys=ON`, если тест претендует на проверку FK-зависимой логики (удаление, каскады).
**Reason:** SQLite по умолчанию не enforces FK constraints — это напрямую привело к тому, что локально "работающий" код падал на реальном Postgres (delete_account P0-регрессия).
**Do not revisit unless:** Меняется база данных тестового окружения на что-то, где это не нужно (например прямое подключение к staging Postgres).

---

**Date:** 2026-06-22
**Decision:** Подключение Telegram-канала и публикация поста — два явных, разделённых шага в UI. Подключение канала никогда не должно автоматически приводить к публикации без отдельного подтверждения пользователя.
**Reason:** Прямое требование из P0-фикса доверия пользователя — автоматическая публикация при подключении канала была критичным UX-багом.
**Do not revisit unless:** Отдельный явный запрос на объединение шагов с полным пересмотром доверительного UX.

---

**Date:** 2026-06-22
**Decision:** Все backend-ошибки, попадающие в UI, должны быть нормализованы на русский язык; сырые ошибки providers (Telegram API, Pydantic validation, Python exceptions) никогда не должны достигать пользователя напрямую.
**Reason:** Серия P0-багов ([object Object], "Bad Request: member list is inaccessible" и т.д.) показала что без централизованной нормализации эта проблема будет возникать снова в каждом новом месте кода.
**Do not revisit unless:** Появится отдельная задача на полную ревизию UI-текстов ошибок.
