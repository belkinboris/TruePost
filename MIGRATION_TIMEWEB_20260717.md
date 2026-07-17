# Миграция TruePost: Railway -> Timeweb Cloud + Alice AI (план от 2026-07-17)

## Решение
Весь стек в РФ: хостинг Timeweb Cloud, LLM — Alice AI (Yandex Cloud
Foundation Models). Причина: DPI РФ-операторов режет Cloudflare<->Railway;
Anthropic API недоступен с РФ-IP. План В (reg.ru статика) отменён в пользу
полного переезда.

## Что уже в коде (этот коммит)
- config.py: LLM_PROVIDER / YANDEX_API_KEY / YANDEX_FOLDER_ID / YANDEX_MODEL_URI
- generator.py: _call_llm роутер, _call_yandex (Foundation Models completion
  API, ретраи и тексты ошибок как у Claude-ветки). Откат = LLM_PROVIDER=anthropic.
- internal_llm_compare.py + роутер в main.py:
  GET /api/internal/llm-compare?count=3 (Bearer internal token) — пары постов
  anthropic vs yandex по реальным каналам, без публикации.
- ОГРАНИЧЕНИЕ: у Yandex API нет web_search. Новостные каналы: проверка
  свежести пропускается (warning в логах), генерация без поиска.
  Фаза 1.5 (отдельная задача): интеграция Яндекс.Поиск API.

## Фаза 0 — тест качества (гейт!)
1. Yandex Cloud: аккаунт -> платёжный аккаунт (стартовый грант) ->
   каталог (folder) -> сервисный аккаунт с ролью ai.languageModels.user ->
   создать Api-Key. Записать: API-ключ + folder_id.
2. В Railway (да, ещё на Railway — API Яндекса доступен отовсюду) добавить:
   YANDEX_API_KEY=..., YANDEX_FOLDER_ID=...
   (LLM_PROVIDER НЕ трогаем — остаётся anthropic, пользователи ничего не видят)
3. Задеплоить этот коммит.
4. VPN + PowerShell:
   Invoke-RestMethod -Uri "https://autopost26.up.railway.app/api/internal/llm-compare?count=3"
     -Headers @{"Authorization"="Bearer ..."} | ConvertTo-Json -Depth 10 | Out-File $HOME\llm.json
5. Смотрим пары глазами. Вердикт: yandex ок / нужен другой YANDEX_MODEL_URI
   (модели Alice AI смотрим в консоли Foundation Models) / остаёмся на
   anthropic через ProxyAPI.

## Фаза 2 — Timeweb Cloud
1. Регистрация timeweb.cloud -> Apps -> деплой из GitHub-репозитория
   (buildpack Python; старт: uvicorn main:app --host 0.0.0.0 --port $PORT).
2. Managed PostgreSQL там же. Перенос данных:
   pg_dump $RAILWAY_DATABASE_URL | psql $TIMEWEB_DATABASE_URL
   (или через файл дампа; договоримся по шагам в чате).
3. Переменные окружения — перенести ВСЕ из Railway, поменяв:
   DATABASE_URL=<timeweb pg>, PUBLIC_URL=https://autopost.projectsozdatel.ru,
   LLM_PROVIDER=yandex (если фаза 0 пройдена).

## Фаза 3 — переключение
1. DNS в Cloudflare: autopost.projectsozdatel.ru -> A-запись на IP Timeweb,
   облако СЕРОЕ (DNS only). Cloudflare-прокси больше не нужен.
2. ЮKassa: URL для уведомлений -> новый домен (тот же путь вебхука).
3. Проверка: регистрация, генерация, оплата тестовым платежом, бот, Mini App.
4. Директ: объявления -> autopost.projectsozdatel.ru/landing.

## Фаза 4 — резерв
Railway живёт неделю параллельно (боты выключить, чтобы не было двойного
поллинга! TELEGRAM_BOT_TOKEN на Railway очистить после переключения).
Через неделю стабильности — гасим Railway. Ротация TRUEPOST_INTERNAL_API_TOKEN
(светился в чате) — при переезде, вместе с остальными секретами.

## Открытые задачи после миграции
- Фаза 1.5: Яндекс.Поиск API для новостных каналов
- Воронка Директа (diag.json так и не снят!) + пересбор семантики
- Бесплатная генерация поста на лендинге без регистрации
