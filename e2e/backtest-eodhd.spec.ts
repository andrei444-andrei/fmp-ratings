import { test, expect } from '@playwright/test';

// Интеграционный тест EODHD: запускается ТОЛЬКО при заданном EODHD_API_KEY (иначе skip).
// Прогоняет бэктест по QQQ на РЕАЛЬНЫХ данных EODHD (adjusted_close) и проверяет, что данные
// настоящие (нет предупреждения о синтетике) и отчёт наполнен без ошибок.
// Запуск: EODHD_API_KEY=... npx playwright test backtest-eodhd --project=desktop
const HAS_KEY = !!process.env.EODHD_API_KEY;

test.describe('Backtest EODHD integration', () => {
  test.skip(!HAS_KEY, 'нужен EODHD_API_KEY для живого интеграционного теста');

  test('QQQ на реальных данных EODHD — без синтетики, отчёт наполнен', async ({ page }) => {
    await page.goto('/backtest');
    // Тикеры задаются в скрипте (UNIVERSE): торгуем QQQ на реальных данных EODHD.
    await page.getByTestId('strategy-code').fill(
      ['UNIVERSE = ["QQQ"]', '', 'def on_bar(ctx):', '    ctx.order_target_percent("QQQ", 1.0)'].join('\n'),
    );
    await page.getByTestId('run-backtest').click();

    // Кривая капитала (итеративный SVG) и метрики появляются.
    await expect(page.getByTestId('equity-chart').locator('svg')).toBeVisible({ timeout: 180000 });
    await expect(page.locator('.research-output .rkit-kpi').first()).toBeVisible({ timeout: 180000 });
    await page.getByText('допущения теста').waitFor({ timeout: 180000 });

    // Ключевая проверка: данные РЕАЛЬНЫЕ (EODHD) → нет предупреждения про синтетику и нет ошибок.
    await expect(page.getByText('данные синтетические')).toHaveCount(0);
    await expect(page.locator('.research-output .rerrblk')).toHaveCount(0);
  });

  // Регресс: метрики бенчмарка НЕ зависят от состава вселенной. Раньше при смешанных календарях
  // (US + Токио) SPY-бенчмарк считался по объединённому индексу с ffill → нулевые дни искажали
  // его волатильность/Sharpe. Теперь бенчмарк считается по своим торговым дням — vol стабильна.
  async function benchVol(page: import('@playwright/test').Page, universe: string[], traded: string) {
    await page.goto('/backtest');
    await page.locator('#start').fill('2016-01-01');
    await page.locator('#end').fill('2023-12-31');
    await page.locator('#benchmark').fill('SPY');
    await page.getByTestId('strategy-code').fill(
      [`UNIVERSE = ${JSON.stringify(universe)}`, '', 'def on_bar(ctx):', `    ctx.order_target_percent("${traded}", 1.0)`].join('\n'),
    );
    await page.getByTestId('run-backtest').click();
    await expect(page.locator('.research-output .rkit-kpi').first()).toBeVisible({ timeout: 180000 });
    await expect(page.locator('.research-output .rt-cap', { hasText: 'Сделки' })).toBeVisible({ timeout: 60000 });
    const rows = await page.locator('.research-output table tbody tr').evaluateAll((trs) =>
      trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim())));
    const volRow = rows.find((r) => /Волатильн/i.test(r[0] || ''));
    // колонка «Бенчмарк» = третья ячейка; "17.6%" → 17.6
    return Number((volRow?.[2] || '').replace('%', '').replace(',', '.'));
  }

  test('метрики бенчмарка не зависят от календаря вселенной (US vs +Токио)', async ({ page }) => {
    const usOnly = await benchVol(page, ['SPY'], 'SPY');
    const mixed = await benchVol(page, ['7203.TSE'], '7203.TSE');
    expect(usOnly).toBeGreaterThan(0);
    expect(mixed).toBeGreaterThan(0);
    // Один и тот же бенчмарк SPY → одинаковая волатильность независимо от вселенной (допуск 1 п.п.).
    expect(Math.abs(usOnly - mixed)).toBeLessThan(1.0);
  });
});
