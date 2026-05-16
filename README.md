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

## Деплой на Vercel + Turso

1. **Создать Turso-базу:**
   ```bash
   brew install tursodatabase/tap/turso
   turso auth signup
   turso db create fmp-ratings
   turso db show fmp-ratings --url    # сохранить как TURSO_DATABASE_URL
   turso db tokens create fmp-ratings  # сохранить как TURSO_AUTH_TOKEN
   ```

2. **Применить миграции к Turso:**
   ```bash
   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run db:migrate
   ```

3. **Запушить в GitHub:**
   ```bash
   gh repo create fmp-ratings --public --source=. --remote=origin --push
   ```

4. **Деплой на Vercel:**
   - vercel.com → Add New Project → импорт из GitHub
   - В Settings → Environment Variables добавить:
     - `FMP_API_KEY` — ключ FinancialModelingPrep (Starter+ для historical-mcap и sp500_constituent)
     - `TURSO_DATABASE_URL`
     - `TURSO_AUTH_TOKEN`
   - Deploy

5. После деплоя открыть URL → запустить pipeline.

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
- `/admin` — DB browser: статистика, просмотр любой таблицы, SQL-консоль (read-only)

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
