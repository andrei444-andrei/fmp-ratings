# Market Lab

Веб-приложение с двумя разделами:

1. **Исследование трендов** (`/research`) — Python-анализ рыночных данных по текстовому
   запросу: AI генерирует код, он исполняется на ценах/фундаментале/дивидендах (FMP),
   результат — таблицы/графики. Исследования и их результаты сохраняются.
2. **Аналитика алгоритмов** (`/quant`) — оценка алгоритмов **QuantConnect** в годовых
   метриках из бектестов: доходность, макс. просадка, накопительная — против бенчмарка.

Плюс служебная **админка** (`/admin`) — БД-браузер, миграции, креды доступа.

## Стек

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS**
- **@libsql/client** + **Drizzle ORM** → **Turso** (production) или локальный SQLite (dev)
- **Pyodide** — исполнение Python в разделе «Исследование трендов»
- Деплой: **Vercel**

## Интеграции

> Каждый сервис заведён **один раз** под одной env-переменной (или, для QuantConnect, в БД)
> и переиспользуется во всех страницах. Дубликаты ключей не заводим.

| Сервис | Где ключ | Lib-модуль | Серверные роуты | UI |
|---|---|---|---|---|
| **FinancialModelingPrep** | `FMP_API_KEY` | `src/lib/fmp.ts` | `/api/research/execute` (через `src/lib/research/*`) | `/research` |
| **aimlapi.com** (LLM-агрегатор, OpenAI-совместимый) | `AIMLAPI_KEY` (+ опц. `AIMLAPI_MODEL`) | `src/lib/aimlapi.ts` | `/api/research/execute`, `/api/research/models` | `/research` |
| **Turso (libSQL)** | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (или `LOCAL_SQLITE_PATH` для dev) | `src/db/client.ts` | `/api/research/*`, `/api/quantconnect/*`, `/api/admin/*`, `/api/read/stats` | `/research`, `/quant`, `/admin` |
| **QuantConnect** | — (креды в БД, вводятся в `/admin/quantconnect`) | `src/lib/quantconnect/*` | `/api/quantconnect/*` (credentials, projects, backtests, algorithms, portfolio) | `/quant`, `/admin/quantconnect` |

**Где задать переменные:**
- Локально: `cp .env.example .env.local` → заполнить.
- Vercel: Project → Settings → Environment Variables → **Redeploy** после изменения.

## Локальный запуск

```bash
npm install
cp .env.example .env.local          # заполнить FMP_API_KEY, AIMLAPI_KEY (+ опц. LOCAL_SQLITE_PATH=./local.db)

npm run db:generate                 # сгенерировать SQL из схемы (по необходимости)
npm run db:migrate                  # применить к БД

npm run dev                         # http://localhost:3000  → редирект на /research
```

## Деплой на Vercel

1. Импортировать репозиторий в Vercel, добавить `FMP_API_KEY` и `AIMLAPI_KEY`.
2. Подключить Turso (Storage → Marketplace → Turso) — Vercel сам добавит `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.
3. Открыть `/admin` → **Run DB migrations** (создаст таблицы). Вспомогательные таблицы
   (`research_*`, `qc_*` и т.п.) самопровижинятся лениво при первом обращении.

## Разделы

### Исследование трендов (`/research`)

Текстовый запрос → AI (AIML) генерирует Python → код исполняется в Pyodide на реальных данных
FMP (дневные цены, фундаментал по секторам/размеру, дивиденды). Результат рендерится таблицами
(в т.ч. многоэтапными и цветными через pandas Styler) и описывается на русском. Исследования
(сохранённый запрос) и их результаты хранятся в Turso, поддерживают редактирование и каскадное
удаление.

### Аналитика алгоритмов (`/quant`)

Оценка алгоритмов QuantConnect по годовым метрикам из бектестов.

1. **Креды** вводятся в `/admin/quantconnect` (QuantConnect → Account → Security: User ID + API Token)
   и хранятся в БД (`qc_credentials`). Токен наружу не отдаётся. Авторизация — SHA-256 HMAC по
   схеме QuantConnect API v2 (`Authorization: Basic`, заголовок `Timestamp`).
2. **Добавить алгоритм** — поиском по проектам (`/projects/read`, выпадающий список) или вводом
   `projectId`/`backtestId` вручную. Алгоритмы складываются в портфель (`qc_algorithms`).
3. **Матрица**: строки — годы; для каждого алгоритма три колонки (макс. просадка за год,
   доходность за год, накопительная), затем бенчмарк. Данные считаются из кривой капитала
   бектеста (`Strategy Equity`) и серии `Benchmark` (`/backtests/chart/read`). Посчитанные
   метрики кэшируются по `backtestId` (`qc_backtest_cache`) — бектест неизменен, кэш бессрочный;
   кнопка «Пересчитать» обходит кэш.

### Админка (`/admin`)

DB browser: статистика, просмотр таблиц, read-only SQL-консоль, кнопка миграций, дамп `app_errors`
(`/api/admin/errors`). Подстраница `/admin/quantconnect` — ввод/хранение кредов QuantConnect.

## Таблицы

| Таблица | Назначение |
|---|---|
| `app_errors` | единый сток ошибок (бэкенд + клиент), читается через `/api/admin/errors` |
| `research_prompts` | сохранённые исследования (запросы) |
| `research_runs` | результаты исследований (привязаны к запросу) |
| `prices` | кэш дневных цен FMP для исследований |
| `fundamentals` | кэш фундаментала (сектор/размер) |
| `dividends` | кэш истории дивидендов |
| `qc_credentials` | креды доступа QuantConnect (singleton; токен не отдаётся на клиент) |
| `qc_algorithms` | портфель алгоритмов QuantConnect (projectId + опц. backtestId + метка) |
| `qc_backtest_cache` | кэш посчитанных годовых метрик бектеста (ключ — projectId:backtestId) |

> Архитектурные принципы и закреплённые имена/контракты — в [CONSTITUTION.md](./CONSTITUTION.md).

## Лицензия

MIT
