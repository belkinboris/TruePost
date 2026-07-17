# План В (2026-07-17): фронт на reg.ru, API на Railway

## Причина
DPI операторов РФ убивает передачу файлов через Cloudflare<->Railway
независимо от размера (проверено: 166КБ, 30КБ, 10КБ — режется всё,
кроме мелкого HTML). Тумблеры CF (ECH off, HTTP/3 off) не помогли.

## Архитектура
- app.projectsozdatel.ru  = статика на хостинге reg.ru (IP 37.140.192.196),
  DNS only (БЕЗ прокси Cloudflare!) — РФ-юзеры качают с РФ-сервера.
- autopost.projectsozdatel.ru = API на Railway за Cloudflare.
  JSON мелкий -> проходит DPI (как HTML).

## Изменения в репозитории (деплой на Railway)
1. app.js / static/app.js: const API_BASE + 3 fetch с префиксом.
   При same-origin (window.API_BASE не задан) поведение прежнее.
2. static/app.part01..16.js: пересборка из нового app.js (16 частей).
3. static/index.html: 16 тегов, кэш-бастер v=20260717a.
4. main.py: CORSMiddleware (origin app.projectsozdatel.ru).

## Railway env после проверки фронта
PUBLIC_URL=https://app.projectsozdatel.ru
(YOOKASSA_RETURN_URL и кнопка Mini App берутся из PUBLIC_URL автоматически)

## Пакет hosting_upload/ — залить на reg.ru
index.html (с window.API_BASE), landing.html (fetch -> абсолютный API),
static/ (чанки, css, legal), robots.txt, .htaccess (маршруты /landing,
/legal/*, SPA-fallback).
