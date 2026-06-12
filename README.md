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

Рабочий стол портфеля стратегий QuantConnect и анализ их бектестов (сменные use-кейсы).

1. **Креды** вводятся в `/admin/quantconnect` (QuantConnect → Account → Security: User ID + API Token)
   и хранятся в БД (`qc_credentials`). Токен наружу не отдаётся. Авторизация — SHA-256 HMAC по
   схеме QuantConnect API v2 (`Authorization: Basic`, заголовок `Timestamp`).
2. **Портфель стратегий** (`qc_algorithms`): добавление — кнопкой-модалкой (поиск по проектам
   `/projects/read` или ввод `projectId`/`backtestId` вручную) с **описанием** и **статусом**
   (`активно` / `исследование` / `архив`). Правка и удаление (с подтверждением). Статус фильтрует
   анализ: `архив` скрыт по умолчанию (тумблер «архив в анализе»).
3. **Use-кейсы** (вкладки) над выбранными стратегиями: готовы **«Сравнение по годам»** и
   **«Объединённый портфель»** (помесячный ребаланс по весам → общая кривая капитала, CAGR,
   итог, макс. просадка vs бенчмарк; `/api/quantconnect/series` отдаёт месячные ряды из того же
   кэша). В дорожной карте — сводка по стратегии, риск/корреляция, анализ просадок.
4. **Матрица сравнения**: строки — годы; по каждой стратегии — просадка, доходность (с маркером
   **▲/▼** относительно бенчмарка), накопительная; затем бенчмарк. Внизу — стат-блок: средние
   за год, разброс σ, лучший/худший год, «лет лучше БМ», итог. Данные — из кривой капитала
   (`Strategy Equity`) и серии `Benchmark` (`/backtests/chart/read`); метрики кэшируются по
   `backtestId` (`qc_backtest_cache`), кнопка «Пересчитать» обходит кэш.

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
| `qc_algorithms` | портфель стратегий QuantConnect (projectId + опц. backtestId, метка, описание, статус) |
| `qc_backtest_cache` | кэш посчитанных годовых метрик бектеста (ключ — projectId:backtestId) |

> Архитектурные принципы и закреплённые имена/контракты — в [CONSTITUTION.md](./CONSTITUTION.md).

## Лицензия

MIT
