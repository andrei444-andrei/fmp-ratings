import { test, expect } from '@playwright/test';
import type { Route } from '@playwright/test';

// Радар событий на /terminal: лента кликабельна → всплывашка с динамикой показателя за годы
// (график + лог публикаций). Радар/индикатор мокаем фикстурой (без ключей сервер отдаёт пустой
// синтетический радар); overview/config обслуживает реальный сервер (синтетика) → дашборд рендерится.
// Заодно проверяем masonry-раскладку виджетов (#3: высокий радар не растягивает строку).

const TODAY = '2026-06-30';

const RADAR_FIXTURE = {
  today: TODAY,
  from: '2026-04-29',
  to: '2026-08-14',
  synthetic: false,
  entries: [
    // прошлое с фактом — кликабельно (макро)
    { date: '2026-06-11', kind: 'macro', id: 'cpi', nameRu: 'Инфляция', eng: 'CPI, г/г', rawEvent: 'Inflation Rate YoY (May)', importance: 1, actual: '3.8%', forecast: '3.9%', prev: '4.2%', unit: '%', goodHigh: false, ticker: null, note: null },
    // прошлое с фактом — заявки (k)
    { date: '2026-06-18', kind: 'macro', id: 'claims', nameRu: 'Заявки на пособие', eng: 'Initial Claims', rawEvent: 'Initial Jobless Claims (Jun/13)', importance: 2, actual: '226K', forecast: '230K', prev: '230K', unit: 'тыс.', goodHigh: false, ticker: null, note: null },
    // будущее — ожидается
    { date: '2026-07-15', kind: 'macro', id: 'retail', nameRu: 'Розничные продажи', eng: 'Retail, м/м', rawEvent: 'Retail Sales MoM (Jun)', importance: 2, actual: null, forecast: '0.4%', prev: '0.9%', unit: '%', goodHigh: true, ticker: null, note: null },
    // отчётность — будущее
    { date: '2026-07-24', kind: 'earnings', id: null, nameRu: 'Отчёт Apple', eng: null, rawEvent: null, importance: 1, actual: null, forecast: null, prev: null, unit: '', goodHigh: null, ticker: 'AAPL', note: 'Крупнейшая компания' },
  ],
};

function cpiHistory() {
  // ~ полтора года месячных публикаций инфляции
  const points = [
    ['2025-01-15', 4.9, 5.0, 5.1],
    ['2025-02-13', 4.6, 4.8, 4.9],
    ['2025-03-12', 4.4, 4.5, 4.6],
    ['2025-04-10', 4.2, 4.3, 4.4],
    ['2025-06-11', 3.8, 3.9, 4.2],
  ].map(([date, actual, forecast, prev]) => ({ date, actual, forecast, prev }));
  return {
    kind: 'macro', id: 'cpi', ticker: null, title: 'Инфляция', eng: 'CPI, г/г',
    desc: 'Инфляция (CPI) — на сколько за год подорожала потребительская корзина.',
    unit: '%', fmt: 'pct', goodHigh: false, points, hasSeries: true, synthetic: false,
  };
}

// Минимальный overview, чтобы дашборд отрисовался МГНОВЕННО и детерминированно (без обращения к
// медленному реальному бэкенду в CI). Пустой blocks — допустимо (грид рендерится, движение дня пустое).
const OVERVIEW_FIXTURE = {
  asOf: '2026-06-29',
  blocks: [],
  regime: { score: 42, avgCorr: 0.35, volRegime: 1.1, breadth: 55, label: 'neutral' },
  correlation: null,
  synthetic: false,
  live: false,
};

test.describe('Радар событий /terminal — всплывашка истории + masonry', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    // Единый детерминированный мок всех market-эндпоинтов: ни одного обращения к реальному бэкенду
    // (в CI он медленный/делает сетевые вызовы FMP) → дашборд и радар рендерятся сразу.
    await page.route('**/api/market/**', (r: Route) => {
      const u = r.request().url();
      if (u.includes('/overview')) return r.fulfill({ json: OVERVIEW_FIXTURE });
      if (u.includes('/config')) return r.fulfill({ json: {} });
      if (u.includes('/radar')) return r.fulfill({ json: RADAR_FIXTURE });
      if (u.includes('/indicator')) {
        if (u.includes('id=cpi')) return r.fulfill({ json: cpiHistory() });
        return r.fulfill({ json: { kind: 'macro', id: null, ticker: null, title: '—', eng: null, desc: 'нет данных', unit: '', fmt: 'raw', goodHigh: null, points: [], hasSeries: false, synthetic: false } });
      }
      // прочие карточки (ротация/ставки/риск/корреляция) — не предмет теста; пусть отрисуют состояние ошибки
      return r.fulfill({ status: 500, json: { error: 'mocked' } });
    });
  });

  test('клик по событию открывает динамику за годы (график + лог)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'детальные взаимодействия — на desktop');
    await page.goto('/terminal');

    // дождаться радара (внутри дашборда)
    await expect(page.getByText('Радар событий', { exact: true })).toBeVisible({ timeout: 120000 });

    // строка инфляции кликабельна
    const row = page.getByRole('button', { name: /Инфляция/ }).first();
    await expect(row).toBeVisible();
    await row.click();

    // всплывашка: заголовок, описание, график (svg path), таблица публикаций
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/подорожала потребительская корзина/)).toBeVisible();
    // график истории (площадь + линия)
    const chart = dialog.locator('svg[viewBox="0 0 620 230"]');
    await expect(chart).toBeVisible({ timeout: 10000 });
    expect(await chart.locator('path').count()).toBeGreaterThanOrEqual(2);
    // лог публикаций со строками
    await expect(dialog.getByText(/Все публикации/)).toBeVisible();
    expect(await dialog.locator('table tbody tr').count()).toBeGreaterThanOrEqual(3);
    // наша последняя точка
    await expect(dialog.getByText('3,8%').first()).toBeVisible();

    // закрыть
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('masonry: сетка виджетов в 2 колонки (узкий радар не растягивает строку)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'masonry — 2 колонки только на широком экране');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/terminal');
    const grid = page.getByTestId('dashboard-grid');
    await expect(grid).toBeVisible({ timeout: 120000 });
    const cols = await grid.evaluate((el) => getComputedStyle(el).columnCount);
    expect(cols).toBe('2');
  });

  test('фильтр «только важное» оставляет события высшей важности', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'на desktop');
    await page.goto('/terminal');
    await expect(page.getByText('Радар событий', { exact: true })).toBeVisible({ timeout: 120000 });
    // до фильтра видна второстепенная «Заявки на пособие»
    await expect(page.getByRole('button', { name: /Заявки на пособие/ })).toBeVisible();
    await page.getByText('только важное').click();
    // после — остаётся «Инфляция» (важность 1), «Заявки» (важность 2) скрыта
    await expect(page.getByRole('button', { name: /Инфляция/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Заявки на пособие/ })).toHaveCount(0);
  });
});
