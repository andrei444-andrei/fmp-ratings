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
});
