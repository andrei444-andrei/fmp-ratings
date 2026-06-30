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
    // график истории (площадь + линия факта + линия прогноза-плана)
    const chart = dialog.locator('svg[viewBox="0 0 620 230"]');
    await expect(chart).toBeVisible({ timeout: 10000 });
    expect(await chart.locator('path').count()).toBeGreaterThanOrEqual(3);
    // линия ПРОГНОЗА (план) — пунктир янтарного цвета
    expect(await chart.locator('path[stroke="#f59e0b"]').count()).toBeGreaterThanOrEqual(1);
    await expect(dialog.getByText('прогноз (план)')).toBeVisible();
    // лог публикаций со строками
    await expect(dialog.getByText(/Все публикации/)).toBeVisible();
    expect(await dialog.locator('table tbody tr').count()).toBeGreaterThanOrEqual(3);
    // наша последняя точка
    await expect(dialog.getByText('3,8%').first()).toBeVisible();

    // закрыть
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('masonry: узкие виджеты в 2 колонки бок-о-бок (высокий радар не оставляет пустоту)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'masonry — 2 колонки только на широком экране');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/terminal');
    await expect(page.getByText('Радар событий', { exact: true })).toBeVisible({ timeout: 120000 });
    const band = page.getByTestId('masonry-band').first();
    await expect(band).toBeVisible();
    // на широком экране полоса раскладывается в ряд (2 колонки), а не в столбик
    const dir = await band.evaluate((el) => getComputedStyle(el).flexDirection);
    expect(dir).toBe('row');
    // ровно 2 колонки-контейнера (после measure-раскладки), карточки бок-о-бок (разный x)
    await expect.poll(() => band.evaluate((el) => el.children.length), { timeout: 10000 }).toBe(2);
    const cards = page.locator('[data-testid="masonry-band"] > div > div');
    const n = await cards.count();
    const xs = new Set<number>();
    for (let i = 0; i < n; i++) {
      const b = await cards.nth(i).boundingBox();
      if (b) xs.add(Math.round(b.x));
    }
    expect(xs.size).toBeGreaterThanOrEqual(2); // карточки стоят в двух разных колонках
  });

  test('тумблер «Главные» оставляет только курируемые главные индикаторы', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'на desktop');
    await page.goto('/terminal');
    await expect(page.getByText('Радар событий', { exact: true })).toBeVisible({ timeout: 120000 });
    // до фильтра видна второстепенная «Заявки на пособие» (claims — не в главных)
    await expect(page.getByRole('button', { name: /Заявки на пособие/ })).toBeVisible();
    await page.getByRole('button', { name: '★ Главные' }).click();
    // после — главные остаются (Инфляция=cpi, Розничные продажи=retail), «Заявки»=claims скрыты
    await expect(page.getByRole('button', { name: /Инфляция/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Розничные продажи/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Заявки на пособие/ })).toHaveCount(0);
  });

  test('кнопка «Сегодня» возвращает к текущему моменту', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'на desktop');
    await page.goto('/terminal');
    await expect(page.getByText('Радар событий', { exact: true })).toBeVisible({ timeout: 120000 });
    const todayBtn = page.getByRole('button', { name: '● Сегодня' });
    await expect(todayBtn).toBeVisible();
    await todayBtn.click();
    // разделитель «Сегодня» в ленте виден после клика
    await expect(page.locator('[data-today]')).toBeVisible();
  });
});
