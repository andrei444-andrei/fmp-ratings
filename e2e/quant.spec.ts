import { test, expect, type Page } from '@playwright/test';

// Смоук раздела «Аналитика алгоритмов» (QuantConnect). Живой путь к QuantConnect в e2e
// недоступен — graceful-состояния + UI-флоу на мок-данных (управление портфелем, матрица v2).

const ALGOS = [
  { id: 1, projectId: '111', backtestId: 'abc', name: 'EMA Cross', benchmark: null, description: 'плечо 2x, контроль просадки', status: 'active', sortOrder: 0, createdAt: '' },
  { id: 2, projectId: '222', backtestId: null, name: 'Mean Reversion', benchmark: null, description: null, status: 'research', sortOrder: 1, createdAt: '' },
];

const PORTFOLIO = {
  years: [2022, 2023],
  algos: [
    {
      id: 1, name: 'EMA Cross', projectId: '111', backtestId: 'abc', resolvedBacktestId: 'abc',
      status: 'active', description: 'плечо 2x, контроль просадки', error: null,
      years: {
        2022: { year: 2022, ret: 0.30, maxDD: -0.10, cumulative: 0.30 },  // > БМ 0.10 → ▲
        2023: { year: 2023, ret: 0.05, maxDD: -0.12, cumulative: 0.365 }, // < БМ 0.20 → ▼
      },
      totalReturn: 0.365, pointCount: 500,
    },
    {
      id: 2, name: 'Mean Reversion', projectId: '222', backtestId: null, resolvedBacktestId: 'def',
      status: 'research', description: null, error: null,
      years: {
        2022: { year: 2022, ret: 0.12, maxDD: -0.08, cumulative: 0.12 },
        2023: { year: 2023, ret: 0.22, maxDD: -0.06, cumulative: 0.366 },
      },
      totalReturn: 0.366, pointCount: 500,
    },
  ],
  benchmark: {
    name: 'SPY',
    years: { 2022: { year: 2022, ret: 0.10, maxDD: -0.20, cumulative: 0.10 }, 2023: { year: 2023, ret: 0.20, maxDD: -0.10, cumulative: 0.32 } },
    totalReturn: 0.32,
  },
};

// синтетический месячный ряд капитала
function monthly(start: number, growth: number, n: number, startYear = 2022) {
  const pts: { ym: string; t: number; v: number }[] = [];
  let v = start;
  for (let i = 0; i < n; i++) {
    const y = startYear + Math.floor(i / 12), m = (i % 12) + 1;
    pts.push({ ym: `${y}-${String(m).padStart(2, '0')}`, t: Math.floor(Date.UTC(y, m - 1, 28) / 1000), v: Math.round(v) });
    v *= 1 + growth;
  }
  return pts;
}
const SERIES = {
  algos: [
    { id: 1, name: 'EMA Cross', status: 'active', error: null, monthly: monthly(100000, 0.025, 36) },
    { id: 2, name: 'Mean Reversion RSI', status: 'research', error: null, monthly: monthly(100000, 0.012, 36) },
  ],
  benchmark: { name: 'Бенчмарк', monthly: monthly(100000, 0.015, 36) },
};

async function mockConfigured(page: Page) {
  await page.route('**/api/quantconnect/credentials**', r => r.fulfill({ json: { configured: true, userId: '123', tokenHint: '••••cafe' } }));
  await page.route('**/api/quantconnect/algorithms**', async route => {
    const m = route.request().method();
    if (m === 'DELETE') return route.fulfill({ json: { algorithms: [ALGOS[1]] } });
    if (m === 'PATCH' || m === 'POST') return route.fulfill({ json: { algorithm: ALGOS[0], algorithms: ALGOS } });
    return route.fulfill({ json: { algorithms: ALGOS } }); // GET
  });
  await page.route('**/api/quantconnect/portfolio**', r => r.fulfill({ json: PORTFOLIO }));
  await page.route('**/api/quantconnect/series**', r => r.fulfill({ json: SERIES }));
  await page.route('**/api/quantconnect/describe**', r => r.fulfill({ json: { description: '## Стратегия\n\nГенерированное **описание**.' } }));
}

test.describe('Аналитика алгоритмов /quant', () => {
  test('без кредов: уведомление и заблокированная кнопка добавления', async ({ page }) => {
    await page.goto('/quant');
    await expect(page.locator('.qc-title')).toHaveText('Аналитика алгоритмов');
    await expect(page.getByText(/Креды QuantConnect не заданы/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.qc-panel-h').filter({ hasText: 'Портфель стратегий' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Добавить стратегию/ })).toBeDisabled();
  });

  test('навигация содержит ссылки на оба раздела', async ({ page }) => {
    await page.goto('/quant');
    await expect(page.getByRole('link', { name: 'Аналитика алгоритмов' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Исследование трендов' })).toBeVisible();
  });

  test('страница всегда светлая, даже при глобальной тёмной теме', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); } catch {} });
    await page.goto('/quant');
    await expect(page.locator('.qc-title')).toBeVisible();
    const probe = await page.evaluate(() => ({
      htmlTheme: document.documentElement.dataset.theme,
      navBg: getComputedStyle(document.querySelector('.app-nav')!).backgroundColor,
    }));
    expect(probe.htmlTheme).toBe('dark');
    expect(probe.navBg).toBe('rgba(255, 255, 255, 0.82)');
  });

  test('вкладки use-кейсов: «Сравнение» и «Объединённый» активны, остальные — disabled', async ({ page }) => {
    await page.goto('/quant');
    await expect(page.getByRole('button', { name: 'Сравнение по годам' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Объединённый портфель' })).toBeEnabled();
    await expect(page.getByRole('button', { name: /Риск \/ корреляция/ })).toBeDisabled();
  });

  test('объединённый портфель: веса, карточки, график, годовая таблица', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    await page.getByRole('button', { name: 'Объединённый портфель' }).click();

    await expect(page.locator('.qc-panel-h').filter({ hasText: 'Состав портфеля' })).toBeVisible();
    // стат-карточки
    await expect(page.locator('.qc-card-k', { hasText: 'CAGR' }).first()).toBeVisible();
    await expect(page.locator('.qc-card-k', { hasText: 'Макс. просадка' })).toBeVisible();
    // график капитала
    await expect(page.locator('svg.qc-chart')).toBeVisible();
    // годовая таблица комбинированной кривой
    await expect(page.locator('.qc-matrix').getByText('Портфель', { exact: true })).toBeVisible();
    // равные веса
    await page.getByRole('button', { name: 'Равные веса' }).click();
  });

  test('кнопка добавления открывает модалку с режимами поиск/вручную', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    await page.getByRole('button', { name: /Добавить стратегию/ }).click();
    await expect(page.locator('.qc-modal-h').filter({ hasText: 'Добавить стратегию' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Вручную' })).toBeVisible();
    await page.getByRole('button', { name: 'Вручную' }).click();
    await expect(page.getByText('Project ID')).toBeVisible();
    await expect(page.getByPlaceholder('123456')).toBeVisible();
    // статус и описание в форме
    await expect(page.getByText('Описание (опц.)')).toBeVisible();
  });

  test('менеджер портфеля: бейджи статусов, описание, матрица v2', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');

    // строки стратегий со статус-бейджами и описанием
    const strat = page.locator('.qc-strat', { hasText: 'EMA Cross' });
    await expect(strat).toBeVisible();
    await expect(strat.locator('.qc-badge.active')).toHaveText('Активно');
    await expect(strat.locator('.qc-strat-desc')).toContainText('плечо 2x');
    await expect(page.locator('.qc-strat', { hasText: 'Mean Reversion' }).locator('.qc-badge.research')).toHaveText('Исследование');

    // матрица: бенчмарк = SPY + заливка ячейки доходности vs бенчмарк
    const matrix = page.locator('.qc-matrix');
    await expect(matrix).toBeVisible();
    await expect(matrix.locator('th.bench')).toHaveText('SPY');
    await expect(matrix.locator('td.qc-beat').first()).toBeVisible(); // обыграл БМ
    await expect(matrix.locator('td.qc-lag').first()).toBeVisible();  // проиграл БМ

    // стат-блок (включая CAGR)
    await expect(matrix.getByText('Ср. / год')).toBeVisible();
    await expect(matrix.getByText('CAGR', { exact: true })).toBeVisible();
    await expect(matrix.getByText('σ (разброс)')).toBeVisible();
    await expect(matrix.getByText('Лучший / худший')).toBeVisible();
    await expect(matrix.getByText('Лет лучше БМ')).toBeVisible();
    await expect(matrix.getByText('Итог', { exact: true })).toBeVisible();
  });

  test('выбор стартового года сужает окно анализа', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    const matrix = page.locator('.qc-matrix');
    await expect(matrix.getByText('2022', { exact: true })).toBeVisible();
    await page.locator('.qc-controls-bar select.qc-select').selectOption('2023');
    await expect(matrix.getByText('2022', { exact: true })).toHaveCount(0);
    await expect(matrix.getByText('2023', { exact: true })).toBeVisible();
  });

  test('удаление стратегии требует подтверждения', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    const strat = page.locator('.qc-strat', { hasText: 'EMA Cross' });
    await strat.getByTitle('Удалить').click();
    await expect(page.getByText(/Действие/)).toBeVisible();
    await expect(page.getByText(/необратимо/)).toBeVisible();
    await page.locator('.qc-modal-foot').getByRole('button', { name: 'Удалить' }).click();
    await expect(page.getByText(/необратимо/)).toHaveCount(0); // модалка закрылась
  });

  test('редактирование: статус, markdown-редактор, генерация из кода', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    const strat = page.locator('.qc-strat', { hasText: 'EMA Cross' });
    await strat.getByTitle('Редактировать').click();
    const modal = page.locator('.qc-modal');
    await expect(modal.locator('.qc-modal-h').filter({ hasText: 'Редактировать стратегию' })).toBeVisible();
    // панель стилей редактора
    await expect(modal.locator('.qc-mde-bar')).toBeVisible();
    await expect(modal.getByTitle('Жирный')).toBeVisible();
    // генерация описания из кода QC
    await modal.getByRole('button', { name: /Сгенерировать из кода/ }).click();
    await expect(modal.locator('textarea.qc-mde-ta')).toHaveValue(/Генерированное/);
    // превью рендерит markdown
    await modal.getByRole('button', { name: 'Превью', exact: true }).click();
    await expect(modal.locator('.qc-mde-preview .qc-md')).toContainText('Стратегия');
    // статус + сохранить
    await modal.locator('select.qc-select').selectOption('archive');
    await page.locator('.qc-modal-foot').getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.locator('.qc-modal-h').filter({ hasText: 'Редактировать стратегию' })).toHaveCount(0);
  });
});

test.describe('Админка кредов QuantConnect /admin/quantconnect', () => {
  test('форма кредов рендерится со статусом «не заданы»', async ({ page }) => {
    await page.goto('/admin/quantconnect');
    await expect(page.getByRole('heading', { name: 'QuantConnect — доступ' })).toBeVisible();
    await expect(page.getByText(/Статус:/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('не заданы')).toBeVisible();
    await expect(page.getByPlaceholder('напр. 123456')).toBeVisible();
  });
});
