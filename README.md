# FMP Ratings — Point-in-Time

Веб-приложение для сбора истории апгрейдов аналитиков по top-N компаниям S&P 500 на каждый год (без survivorship bias).

## Что делает

1. **Phase 0** — реконструирует состав S&P 500 на 31 декабря каждого года через FMP `/api/v3/historical/sp500_constituent` (откат изменений индекса с текущей даты в прошлое).
2. **Phase 1** — для каждого года ранжирует (S&P 500 на дату) ∪ (foreign ADR ~30 шт) по historical market cap, берёт top-N.
3. **Phase 2** — для уникальных тикеров из всех top-N тянет grades (изменения рейтингов аналитиков).
4. **Phase 3** — фильтр: новый рейтинг ∈ {Buy, Strong Buy} И скачок ≥ N уровней. Результат с year-колонкой.

Данные пишутся в Turso (libSQL — SQLite-совместимый serverless), доступны через UI и REST API.

## Стек

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS**
- **Drizzle ORM** + **@libsql/client**
- **Turso** (production DB) или локальный SQLite (dev)
- Деплой: **Vercel**

## Интеграции (что уже подключено)

> ⚠️ Перед добавлением «новой» интеграции — сверьтесь с таблицей.
> Каждый сервис заведён **один раз** под одной env-переменной и переиспользуется во всех страницах.
> Дубликаты (`MARKETAUX_API_TOKEN`, `OPENAI_API_KEY`, и т.п.) — не заводим.

| Сервис | Env-переменная | Lib-модуль | Серверные роуты | Используется в UI |
|---|---|---|---|---|
| **FinancialModelingPrep** | `FMP_API_KEY` | `src/lib/fmp.ts` | `/api/fmp/*` (sp500, sp500-history, historical-mcap, historical-price-eod, grades, grades-historical, earnings) | `/`, `/results`, `/eps`, `/signals`, `/heatmap`, `/market-events` |
| **Turso (libSQL)** | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (или `LOCAL_SQLITE_PATH` для dev) | `src/db/client.ts`, `src/db/schema.ts` | `/api/save/*`, `/api/read/*`, `/api/admin/*`, `/api/eps/*`, news-cache | `/`, `/results`, `/admin`, `/eps`, `/heatmap`, `/market-events` |
| **aimlapi.com** (LLM-агрегатор, OpenAI-совместимый) | `AIMLAPI_KEY` | `src/lib/aimlapi.ts` | `/api/ai/news`, `/api/ai/events-month`, `/api/ai/keywords`, `/api/ai/cluster-events`, `/api/ai/find-events` | `/heatmap` (popup новостей), `/market-events` (двухшаговый поиск) |
| **Marketaux News API** | `MARKETAUX_KEY` (+ опц. `MARKETAUX_MONTHLY_CAP`, default 8000) | `src/lib/marketaux.ts` | `/api/ai/news` (заголовки), `/api/events/month-news`, `/api/events/usage`, `/api/marketaux/debug` | `/heatmap` (новости дня + поиск событий), `/admin/marketaux` (отладка) |
| **GDELT 2.0 DOC** (бесплатный) | — (без ключа) | `src/lib/gdelt.ts` | `/api/news/gdelt`, `/api/gdelt/debug` | `/market-events` (поиск архивных статей), `/admin/gdelt` (отладка) |

**Где задать переменные:**
- Локально: `cp .env.example .env.local` → заполнить.
- Vercel: Project → Settings → Environment Variables → **Redeploy** после изменения.

## Локальный запуск

```bash
git clone <repo>
cd fmp-ratings
npm install

# создайте .env.local
cp .env.example .env.local
# заполните FMP_API_KEY (и опционально LOCAL_SQLITE_PATH=./local.db)

# применить миграции
npm run db:generate    # создать SQL из schema
npm run db:migrate     # применить к БД

npm run dev
# открыть http://localhost:3000
```

## Деплой на Vercel (zero-CLI flow)

1. **Импортировать репо в Vercel:**
   - vercel.com → Add New Project → импорт из GitHub `fmp-ratings`
   - Пока что добавьте только `FMP_API_KEY` в env. Deploy упадёт на DB-вызовах — это нормально.

2. **Подключить Turso через Vercel Marketplace** (без CLI!):
   - В проекте на Vercel → вкладка **Storage** → **Create Database** → **Marketplace** → **Turso** → Install
   - Авторизация Turso через GitHub, выбрать проект
   - Vercel автоматически добавит `TURSO_DATABASE_URL` и `TURSO_AUTH_TOKEN` в env-переменные
   - Триггер redeploy (commit или ручной)

3. **Применить миграции одной кнопкой:**
   - Открыть `https://your-app.vercel.app/admin`
   - Нажать **Run DB migrations** — создаст 7 таблиц в Turso
   - Готово

4. **Запустить pipeline:**
   - Открыть `/` → кнопка ▶ Run pipeline
   - Прогресс в логе, результаты на `/results`, состояние таблиц на `/admin`

### Альтернатива через CLI

Если предпочитаете CLI-флоу:
```bash
brew install tursodatabase/tap/turso
turso auth signup
turso db create fmp-ratings
turso db show fmp-ratings --url        # → TURSO_DATABASE_URL
turso db tokens create fmp-ratings     # → TURSO_AUTH_TOKEN
TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run db:migrate
```
Затем добавить эти env в Vercel вручную.

## Архитектура

```
Browser (React UI)
  │
  │  POST /api/runs                  ← старт run
  │  GET  /api/fmp/sp500             ─┐
  │  GET  /api/fmp/sp500-history     ─┤
  │  GET  /api/fmp/historical-mcap   ─┼─→ Vercel API routes ─→ FMP API
  │  GET  /api/fmp/grades            ─┘                     ↑
  │                                                   FMP_API_KEY (env)
  │  POST /api/save/sp500            ─┐
  │  POST /api/save/sp500-history    ─┤
  │  POST /api/save/mcap             ─┼─→ Vercel API routes ─→ Turso (libSQL)
  │  POST /api/save/grades           ─┤
  │  POST /api/save/top-n            ─┘
  │
  │  POST /api/compute-filtered      ─→ Vercel API routes ─→ Turso (filter)
  │
  │  GET  /api/read/filtered         ─→ Vercel API routes ─→ Turso (read)
  │  GET  /api/read/top-by-year
  │  GET  /api/read/stats
  │  GET  /api/admin/table
  │  POST /api/admin/query           (read-only SQL console)
```

FMP-вызовы идут с клиента к нашему backend-проксе (FMP_API_KEY не виден в браузере), потом результаты POST'ятся обратно для записи в Turso.

**Почему так:** Vercel serverless-функции имеют timeout 10–60 сек. Полный pipeline (≈6000 FMP-вызовов, ~10 мин) не влезает в одну функцию. Браузер дольше живёт — он оркестрирует, сервер просто проксирует и пишет.

## Страницы

- `/` — pipeline runner (настройки, запуск, логи, stats)
- `/results` — финальные апгрейды по годам, CSV-экспорт
- `/heatmap` — дневная доходность тикеров × дни с маркерами событий
- `/market-events` — AI ищет исторические события по текстовому запросу, таблица доходности актива (по умолчанию SPY) на T+1d/T+2d/.../T+180d
- `/admin` — DB browser: статистика, просмотр любой таблицы, SQL-консоль (read-only)

### Market Events (AI + GDELT)

Раздел использует комбинацию **GDELT 2.0 DOC API** (новостной агрегатор, без ключа, история с 2015)
и **AIML API** (OpenAI-совместимый — для генерации поисковых ключей и кластеризации статей).

Нужна переменная окружения:

```
AIMLAPI_KEY=...
```

Поток (4 шага):
1. Пользователь описывает тип событий + задаёт диапазон лет (`yearFrom`/`yearTo`, минимум 2015).
2. **AI → ключевые слова:** генерирует EN-запрос для GDELT с OR-альтернативами.
3. **GDELT:** ищет статьи по годовым чанкам (≤250 на год), дедуп по URL.
4. **AI → кластеризация:** группирует статьи в значимые события с точной датой старта.
5. Для актива (по умолчанию `SPY`, настраивается) подгружаются дневные цены из FMP.
6. Таблица: строки = события, колонки = доходность актива на T+1d, T+2d, T+3d, T+7d, T+14d, T+30d, T+60d, T+90d, T+180d (настраиваемо).
7. Доходность — накопительная от T+0 (первый торговый день ≥ даты события) или периодная между точками.

UI показывает сгенерированный GDELT-запрос и (по запросу) сырой список статей —
полезно, если AI «промахивается» с темой.

### Heatmap → новости дня (Marketaux + AI)

Клик по дате в `/heatmap` → кнопка «📰 Загрузить новости дня». Поток:

1. **Кэш в Turso** (`news_day_cache`) — если дата уже запрашивалась, ответ из БД мгновенно, **0 внешних вызовов**. Исторические новости не меняются, кэш бессрочный.
2. **Marketaux** — 1 запрос за дату, история с 2017. Без `MARKETAUX_KEY` endpoint возвращает 503 с понятной ошибкой (никаких бесплатных fallback'ов в /heatmap нет).
3. **AI** (AIML) выбирает 3-5 значимых из реальных заголовков и описывает на русском только фактуру (без «оказало влияние / инвесторы реагируют»).
4. Результат записывается в кэш.

Переменные окружения:
```
AIMLAPI_KEY=...                  # обязательно (AI-фильтрация)
MARKETAUX_KEY=...                # обязательно для новостей в /heatmap
MARKETAUX_MONTHLY_CAP=8000       # опционально; safety cap по месячному расходу
```

Кнопка «🔄 Обновить новости» добавляет `?force=1` — обходит кэш и пересчитывает.

GDELT остаётся **только** в `/market-events` (там диапазон в 5-10 лет, Marketaux выжег бы квоту).

### Heatmap → «🔥 Найти важные события за диапазон»

Помечает на хитмапе маркеры значимых событий ДО клика по дате. Источник — Marketaux, AI — только для кластеризации (не сочиняет события).

Поток:
1. Клиент бьёт диапазон на месяцы.
2. Для каждого месяца — `GET /api/events/month-news?month=YYYY-MM` → 1 Marketaux запрос (limit=30, `sort=relevance_score`, `filter_entities=true`). Кэшируется в Turso (`news_month_cache`), повторный пересчёт того же диапазона стоит 0 calls.
3. Все собранные заголовки (60×30 для 5-летнего диапазона) уходят в `/api/ai/cluster-events` → AI группирует в 20-50 крупных событий с категориями и датами.
4. События сохраняются в localStorage и рисуются маркерами на хитмапе.

Бюджет: ~12 calls на год, ~60 на 5 лет, **один раз** на диапазон. Дальше — кэш.

Расход показывает `GET /api/events/usage` → `{ used, cap, remaining }`.

## Таблицы

| Таблица | Назначение |
|---|---|
| `sp500_current` | текущий состав S&P 500 (snapshot последней загрузки) |
| `sp500_changes` | история изменений S&P 500 (добавления/удаления с датами) |
| `market_cap` | (symbol, date) → market cap, для каждого snapshot date |
| `grades` | все рейтинговые действия (raw из FMP) |
| `top_n_per_year` | computed top-N на 31.12 каждого года |
| `rating_changes_filtered` | финал: апгрейды с фильтром, ready for CSV |
| `runs` | метаданные запусков pipeline |

## Лицензия

MIT
