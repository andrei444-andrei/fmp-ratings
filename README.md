# Market Lab

Веб-приложение для рыночного исследования. Разделы (навигация):

1. **Рыночный терминал** (`/terminal`) — сводный обзор рынка: ставки, ротация, риск, история план/факт.
2. **Анализ тикера** (`/ticker`) — карточка отдельного инструмента по данным провайдеров.
3. **Скринер** (`/researcher`) — отбор бумаг по факторам/формулам; скрин-движок считает на Pyodide.
4. **Портфели** (`/portfolios`) — составление и расчёт портфелей.
5. **Аналитика алгоритмов** (`/quant`) — оценка алгоритмов **QuantConnect** по годовым метрикам бектестов.
6. **Polymarket** (`/polymarket`) — данные рынков предсказаний.

Плюс служебная **админка** (`/admin`) — БД-браузер, миграции, креды доступа.

## Стек

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS**
- **@libsql/client** + **Drizzle ORM** → **Turso** (production) или локальный SQLite (dev)
- **Pyodide** — исполнение Python в скрин-движке (`/researcher`)
- Деплой: **Vercel**

## Интеграции

> Каждый сервис заведён **один раз** под одной env-переменной (или, для QuantConnect, в БД)
> и переиспользуется во всех страницах. Дубликаты ключей не заводим.

| Сервис | Где ключ | Lib-модуль | UI |
|---|---|---|---|
| **FinancialModelingPrep** | `FMP_API_KEY` | `src/lib/fmp.ts` (+ `src/lib/research/*`, `src/lib/signals/*`) | `/researcher`, `/terminal`, `/ticker` |
| **EODHD** (опц. — если задан, основной источник цен/составов) | `EODHD_API_KEY` | `src/lib/eodhd.ts` (через `src/lib/research/prices`) | `/researcher`, `/terminal`, `/ticker` |
| **aimlapi.com** (LLM-агрегатор, OpenAI-совместимый) | `AIMLAPI_KEY` (+ опц. `AIMLAPI_MODEL`) | `src/lib/aimlapi.ts` | `/researcher`, `/quant` |
| **Turso (libSQL)** | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (или `LOCAL_SQLITE_PATH` для dev) | `src/db/client.ts` | все разделы |
| **QuantConnect** | — (креды в БД, вводятся в `/admin/quantconnect`) | `src/lib/quantconnect/*` | `/quant`, `/admin/quantconnect` |

**Где задать переменные:**
- Локально: `cp .env.example .env.local` → заполнить.
- Vercel: Project → Settings → Environment Variables → **Redeploy** после изменения.

## Локальный запуск

```bash
npm install
cp .env.example .env.local          # заполнить FMP_API_KEY, AIMLAPI_KEY (+ опц. LOCAL_SQLITE_PATH=./local.db)

npm run db:generate                 # сгенерировать SQL из схемы (по необходимости)
npm run db:migrate                  # применить к БД

npm run dev                         # http://localhost:3000  → редирект на /terminal
```

## Деплой на Vercel

1. Импортировать репозиторий в Vercel, добавить `FMP_API_KEY` и `AIMLAPI_KEY`.
2. Подключить Turso (Storage → Marketplace → Turso) — Vercel сам добавит `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.
3. Открыть `/admin` → **Run DB migrations** (создаст таблицы). Вспомогательные таблицы
   (`qc_*` и т.п.) самопровижинятся лениво при первом обращении.

## Разделы

### Аналитика алгоритмов (`/quant`)

Рабочий стол портфеля стратегий QuantConnect и анализ их бектестов (сменные use-кейсы).

1. **Креды** вводятся в `/admin/quantconnect` (QuantConnect → Account → Security: User ID + API Token)
   и хранятся в БД (`qc_credentials`). Токен наружу не отдаётся. Авторизация — SHA-256 HMAC по
   схеме QuantConnect API v2 (`Authorization: Basic`, заголовок `Timestamp`).
2. **Портфель стратегий** (`qc_algorithms`): добавление — кнопкой-модалкой (поиск по проектам
   `/projects/read` или ввод `projectId`/`backtestId` вручную) с **описанием** и **статусом**
   (`активно` / `исследование` / `архив`). Правка и удаление (с подтверждением). Статус фильтрует
   анализ: `архив` скрыт по умолчанию (тумблер «архив в анализе»).
3. **Use-кейсы** (вкладки) над выбранными стратегиями:
   - **«Сравнение по годам»** — матрица доходность/просадка/накопит. vs SPY;
   - **«Объединённый портфель»** — ребаланс к весам раз в месяц, эквити **по дням** →
     **реальная дневная просадка**; CAGR, итог, vs бенчмарк (`/api/quantconnect/series` — дневные ряды);
   - **«Риск / корреляция»** — корреляционная матрица по доходностям (день/неделя/месяц, Pearson/ранговая),
     ENB/доля 1-й компоненты (PCA), diversification ratio, downside-корреляция (SPY&lt;0) и правило
     диверсификации Sᵢ&gt;ρ·S_rest (`src/lib/quantconnect/risk.ts`);
   - **«Сводка по стратегии»** — CAGR, Sharpe/Sortino/Calmar, реальная дневная просадка, кривая капитала
     vs SPY и помесячный heatmap доходностей (`src/lib/quantconnect/summary.ts`);
   - **«Анализ просадок»** — underwater-кривая (дневная) и таблица эпизодов просадок (пик → дно →
     восстановление, глубина, длительности) (`src/lib/quantconnect/drawdowns.ts`).
4. **Матрица сравнения**: строки — годы; по каждой стратегии — просадка, доходность (с маркером
   **▲/▼** относительно бенчмарка), накопительная; затем бенчмарк. Внизу — стат-блок: средние
   за год, разброс σ, лучший/худший год, «лет лучше БМ», итог. Данные — из кривой капитала
   (`Strategy Equity`) и серии `Benchmark` (`/backtests/chart/read`); метрики кэшируются по
   `backtestId` (`qc_backtest_cache`), кнопка «Пересчитать» обходит кэш.
5. **AI-ассистент** (всплывающий чат на `/quant`, `POST /api/quantconnect/chat`): отвечает на вопросы
   о стратегиях по полным данным портфеля — сервер подставляет в промпт описание, **торгуемые
   инструменты (из кода)**, **статистику бектеста** (Sharpe/Sortino/трейды/win-rate),
   **реальную дневную просадку** с датами, лучший/худший месяц и годовую разбивку vs SPY;
   AI отвечает в Markdown через aimlapi.

### Админка (`/admin`)

DB browser: статистика, просмотр таблиц, read-only SQL-консоль, кнопка миграций, дамп `app_errors`
(`/api/admin/errors`). Подстраница `/admin/quantconnect` — ввод/хранение кредов QuantConnect.

## Таблицы

| Таблица | Назначение |
|---|---|
| `app_errors` | единый сток ошибок (бэкенд + клиент), читается через `/api/admin/errors` |
| `prices` | кэш дневных цен FMP/EODHD (purpose-built: один раз скачали — дальше из БД) |
| `price_meta` | покрытие кэша цен на тикер (до какого `from` тянули, `last_date`, когда освежали) |
| `fundamentals` | кэш фундаментала (сектор/размер) |
| `dividends` | кэш истории дивидендов |
| `qc_credentials` | креды доступа QuantConnect (singleton; токен не отдаётся на клиент) |
| `qc_algorithms` | портфель стратегий QuantConnect (projectId + опц. backtestId, метка, описание, статус) |
| `qc_backtest_cache` | кэш посчитанных метрик бектеста (годовые + дневные ряды; ключ — projectId:backtestId) |
| `qc_settings` | настройки раздела (key-value JSON), напр. сохранённый состав/веса объединённого портфеля |

> Архитектурные принципы и закреплённые имена/контракты — в [CONSTITUTION.md](./CONSTITUTION.md).

## Лицензия

MIT
