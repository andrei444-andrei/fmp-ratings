import { test, expect } from '@playwright/test';

// Смоук «Тестирование стратегий» (/backtest): детерминированный событийный движок исполняется
// ПО-НАСТОЯЩЕМУ на синтетических ценах (без ключей FMP/AIMLAPI) на дефолтной лонг/шорт стратегии.
// Проверяем, что отчёт собирается (метрики, график, модель издержек, сделки) без карточек ошибок,
// и что прогон сохраняется/открывается/удаляется.

type Page = import('@playwright/test').Page;

// Сужаем вселенную до 3 синтетических тикеров — чтобы прогон уложился в таймаут.
// Новая модель: тикеры задаются ПРЯМО В СКРИПТЕ переменной UNIVERSE, движок торгует именно их.
async function runSmallBacktest(page: Page) {
  await page.goto('/backtest');
  await page.getByTestId('strategy-code').fill(
    [
      'UNIVERSE = ["AAA", "BBB", "CCC"]',
      '',
      'def on_bar(ctx):',
      '    for s in ctx.symbols:',
      '        h = ctx.history(s, 20)',
      '        if len(h) < 20:',
      '            continue',
      '        if h[-1] > h[:-1].mean():',
      '            ctx.order_target_percent(s, 1.0 / len(ctx.symbols))',
      '        else:',
      '            ctx.order_target_percent(s, 0.0)',
    ].join('\n'),
  );
  await page.getByTestId('run-backtest').click();
}

test.describe('Backtest /backtest', () => {
  test('страница и пустое состояние рендерятся', async ({ page }) => {
    await page.goto('/backtest');
    await expect(page.getByRole('heading', { name: 'Параметры теста' })).toBeVisible();
    await expect(page.getByText('Здесь появится отчёт бэктеста')).toBeVisible();
    await expect(page.getByTestId('run-backtest')).toBeVisible();
    // Дефолтная стратегия предзаполнена.
    await expect(page.getByTestId('strategy-code')).toContainText('def on_bar(ctx):');
    // AI-панель: поле описания задачи + кнопка генерации.
    await expect(page.getByTestId('draft-prompt')).toBeVisible();
    await expect(page.getByTestId('draft-btn')).toBeVisible();
  });

  test('прогоняет стратегию и рендерит отчёт без ошибок', async ({ page }) => {
    await runSmallBacktest(page);
    // Кривая капитала (итеративный SVG) появляется по ходу прогона, метрики — после.
    await expect(page.getByTestId('equity-chart').locator('svg')).toBeVisible({ timeout: 180000 });
    await expect(page.locator('.research-output .rkit-kpi').first()).toBeVisible({ timeout: 180000 });
    // Таблица модели издержек по рынкам и лог сделок.
    await expect(page.locator('.research-output .rt-cap', { hasText: 'Модель издержек по рынкам' })).toBeVisible({ timeout: 60000 });
    await expect(page.locator('.research-output .rt-cap', { hasText: 'Сделки' })).toBeVisible({ timeout: 60000 });
    // Ни одной карточки ошибки.
    await expect(page.locator('.research-output .rerrblk')).toHaveCount(0);
  });

  test('сохранение → открытие → удаление прогона', async ({ page }) => {
    await runSmallBacktest(page);
    await expect(page.locator('.research-output .rkit-kpi').first()).toBeVisible({ timeout: 180000 });

    await page.getByRole('button', { name: 'Сохранить результат' }).click();
    const title = 'e2e бэктест ' + Date.now();
    await page.getByPlaceholder('Название прогона').fill(title);
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Результат сохранён')).toBeVisible({ timeout: 15000 });

    const item = page.getByTestId('saved-runs').locator('[data-testid="run-open"]').filter({ hasText: title });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.getByText('Сохранённый результат')).toBeVisible();
    await expect(page.locator('.research-output .rkit-kpi').first()).toBeVisible();

    const li = page.getByTestId('saved-runs').locator('li').filter({ hasText: title });
    await li.getByRole('button', { name: 'Удалить прогон' }).click();
    await expect(page.getByText('Результат удалён')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('saved-runs').locator('[data-testid="run-open"]').filter({ hasText: title })).toHaveCount(0);
  });
});
