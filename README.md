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

### Market Events (AI)

Раздел использует [AIML API](https://aimlapi.com) (OpenAI-совместимый агрегатор) для поиска
исторических событий по текстовому запросу. Для работы нужна переменная окружения:

```
AIMLAPI_KEY=...
```

Поток:
1. Пользователь описывает тип событий ("Крупные обвалы из-за геополитики", "Дни заседаний ФРС с хайком ≥75bp", …).
2. AI (gpt-4o-mini по умолчанию) возвращает JSON: `[{date, title, description, category}]`.
3. Для актива (по умолчанию SPY) подгружаются дневные цены закрытия из FMP.
4. Таблица: строки = события, колонки = доходность на T+1d, T+2d, T+3d, T+7d, T+14d, T+30d, T+60d, T+90d, T+180d (настраиваемо).
5. Доходность — накопительная от T+0 (первого торгового дня ≥ даты события) или периодная между точками.

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
