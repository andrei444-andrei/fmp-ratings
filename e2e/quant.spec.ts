import { test, expect } from '@playwright/test';

// Смоук раздела «Аналитика алгоритмов» (QuantConnect). В e2e кредов QC нет и сети к
// quantconnect.com нет — проверяем graceful-состояния: страница рендерится, видно
// уведомление «нет кредов», форма добавления заблокирована, админ-страница кредов
// показывает статус «не заданы». Никаких внешних вызовов на маунте не происходит.

test.describe('Аналитика алгоритмов /quant', () => {
  test('страница рендерится: заголовок, методология, форма добавления', async ({ page }) => {
    await page.goto('/quant');
    await expect(page.locator('.qc-title')).toHaveText('Аналитика алгоритмов');
    await expect(page.getByText('Как читать матрицу')).toBeVisible();
    await expect(page.locator('.qc-panel-h').filter({ hasText: 'Добавить алгоритм' })).toBeVisible();
    // строки/колонки описаны в методологии
    await expect(page.getByText(/Строки/)).toBeVisible();
  });

  test('без кредов: уведомление и заблокированная форма', async ({ page }) => {
    await page.goto('/quant');
    // уведомление с ссылкой в админку
    await expect(page.getByText(/Креды QuantConnect не заданы/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('link', { name: /админке/ })).toHaveAttribute('href', '/admin/quantconnect');
    // поле поиска проекта недоступно (disabled), пока нет кредов
    await expect(page.getByPlaceholder('напр. EMA Cross')).toBeDisabled();
  });

  test('переключение режима «Вручную» показывает поля Project ID / Backtest', async ({ page }) => {
    await page.goto('/quant');
    await page.getByRole('button', { name: 'Вручную' }).click();
    await expect(page.getByText('Project ID')).toBeVisible();
    await expect(page.getByPlaceholder('123456')).toBeVisible();
  });

  test('навигация содержит ссылки на оба раздела', async ({ page }) => {
    await page.goto('/quant');
    await expect(page.getByRole('link', { name: 'Аналитика алгоритмов' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Исследование трендов' })).toBeVisible();
  });

  // Матрица на синтетических данных (живой путь к QuantConnect в e2e недоступен):
  // мокаем API-ответы и проверяем, что матрица строится — годы-строки, группы-колонки,
  // бенчмарк, форматирование процентов и строка «Итог».
  test('матрица строится из данных портфеля (мок API)', async ({ page }) => {
    const algorithms = [
      { id: 1, projectId: '111', backtestId: 'abc', name: 'Alpha EMA', benchmark: null, sortOrder: 0, createdAt: '' },
      { id: 2, projectId: '222', backtestId: null, name: 'Beta Mean', benchmark: null, sortOrder: 1, createdAt: '' },
    ];
    const portfolio = {
      years: [2022, 2023],
      algos: [
        {
          id: 1, name: 'Alpha EMA', projectId: '111', backtestId: 'abc', resolvedBacktestId: 'abc', error: null,
          years: {
            2022: { year: 2022, ret: 0.15, maxDD: -0.08, cumulative: 0.15 },
            2023: { year: 2023, ret: 0.05, maxDD: -0.12, cumulative: 0.2075 },
          },
          totalReturn: 0.2075, pointCount: 500,
        },
        {
          id: 2, name: 'Beta Mean', projectId: '222', backtestId: null, resolvedBacktestId: 'def', error: null,
          years: {
            2022: { year: 2022, ret: 0.20, maxDD: -0.10, cumulative: 0.20 },
            2023: { year: 2023, ret: 0.10, maxDD: -0.06, cumulative: 0.32 },
          },
          totalReturn: 0.32, pointCount: 500,
        },
      ],
      benchmark: {
        name: 'Бенчмарк',
        years: {
          2022: { year: 2022, ret: 0.18, maxDD: -0.25, cumulative: 0.18 },
          2023: { year: 2023, ret: 0.24, maxDD: -0.10, cumulative: 0.4632 },
        },
        totalReturn: 0.4632,
      },
    };
    await page.route('**/api/quantconnect/credentials', r => r.fulfill({ json: { configured: true, userId: '123', tokenHint: '••••cafe' } }));
    await page.route('**/api/quantconnect/algorithms', r => r.fulfill({ json: { algorithms } }));
    await page.route('**/api/quantconnect/portfolio**', r => r.fulfill({ json: portfolio }));

    await page.goto('/quant');

    const matrix = page.locator('.qc-matrix');
    await expect(matrix).toBeVisible();
    // группы-колонки и бенчмарк в шапке
    await expect(matrix.getByText('Alpha EMA')).toBeVisible();
    await expect(matrix.getByText('Beta Mean')).toBeVisible();
    await expect(matrix.locator('th.bench')).toHaveText('Бенчмарк');
    // строки-годы + итог
    await expect(matrix.getByText('2022', { exact: true })).toBeVisible();
    await expect(matrix.getByText('2023', { exact: true })).toBeVisible();
    await expect(matrix.getByText('Итог', { exact: true })).toBeVisible();
    // форматирование процентов: значения присутствуют (могут повторяться в разных ячейках)
    await expect(matrix.getByText('+15.0%').first()).toBeVisible(); // Alpha 2022 доходн.
    await expect(matrix.getByText('+32.0%').first()).toBeVisible(); // Beta накопит./итог
    await expect(matrix.getByText('−8.0%').first()).toBeVisible();  // Alpha 2022 просадка (U+2212)
    // чипы портфеля
    await expect(page.locator('.qc-chip', { hasText: 'Alpha EMA' })).toBeVisible();
  });
});

test.describe('Админка кредов QuantConnect /admin/quantconnect', () => {
  test('форма кредов рендерится со статусом «не заданы»', async ({ page }) => {
    await page.goto('/admin/quantconnect');
    await expect(page.getByRole('heading', { name: 'QuantConnect — доступ' })).toBeVisible();
    await expect(page.getByText(/Статус:/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('не заданы')).toBeVisible();
    await expect(page.getByPlaceholder('напр. 123456')).toBeVisible(); // User ID
  });
});
