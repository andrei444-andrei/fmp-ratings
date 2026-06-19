import { test, expect } from '@playwright/test';

// Смоук «Тестирование стратегий» (/backtest): детерминированный событийный движок исполняется
// ПО-НАСТОЯЩЕМУ на синтетических ценах (без ключей FMP/AIMLAPI) на стратегии с UNIVERSE в коде.
// Проверяем отчёт (метрики/график/издержки/сделки) без карточек ошибок, автосохранение, а также
// сохранение/навигацию двух сущностей: СТРАТЕГИЙ и РЕЗУЛЬТАТОВ прогонов.

type Page = import('@playwright/test').Page;

// Маленькая стратегия (3 синтетических тикера) — чтобы прогон уложился в таймаут.
// Новая модель: тикеры задаются ПРЯМО В СКРИПТЕ переменной UNIVERSE.
async function fillSmallStrategy(page: Page) {
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
}

async function runSmallBacktest(page: Page) {
  await fillSmallStrategy(page);
  await page.getByTestId('run-backtest').click();
}

test.describe('Backtest /backtest', () => {
  test('страница и пустое состояние рендерятся', async ({ page }) => {
    await page.goto('/backtest');
    await expect(page.getByRole('heading', { name: 'Параметры теста' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Библиотека' })).toBeVisible();
    await expect(page.getByText('Здесь появится отчёт бэктеста')).toBeVisible();
    await expect(page.getByTestId('run-backtest')).toBeVisible();
    // Дефолтная стратегия предзаполнена, есть кнопка сохранения стратегии.
    await expect(page.getByTestId('strategy-code')).toContainText('def on_bar(ctx):');
    await expect(page.getByTestId('save-strategy')).toBeVisible();
    // AI-панель: поле описания задачи + кнопка генерации.
    await expect(page.getByTestId('draft-prompt')).toBeVisible();
    await expect(page.getByTestId('draft-btn')).toBeVisible();
  });

  test('прогоняет стратегию, рендерит отчёт без ошибок и автосохраняет', async ({ page }) => {
    await runSmallBacktest(page);
    // Кривая капитала (итеративный SVG) появляется по ходу прогона, метрики — после.
    await expect(page.getByTestId('equity-chart').locator('svg')).toBeVisible({ timeout: 180000 });
    await expect(page.locator('.research-output .rkit-kpi').first()).toBeVisible({ timeout: 180000 });
    // Таблица модели издержек по рынкам и лог сделок.
    await expect(page.locator('.research-output .rt-cap', { hasText: 'Модель издержек по рынкам' })).toBeVisible({ timeout: 60000 });
    await expect(page.locator('.research-output .rt-cap', { hasText: 'Сделки' })).toBeVisible({ timeout: 60000 });
    // Ни одной карточки ошибки.
    await expect(page.locator('.research-output .rerrblk')).toHaveCount(0);
    // Автосохранение: после прогона результат уходит в группу «Автосохранения».
    await expect(page.getByTestId('autosaves').locator('[data-testid="autosave-open"]').first()).toBeVisible({ timeout: 30000 });
  });

  test('сохранение → открытие → удаление РЕЗУЛЬТАТА', async ({ page }) => {
    await runSmallBacktest(page);
    await expect(page.locator('.research-output .rkit-kpi').first()).toBeVisible({ timeout: 180000 });

    await page.getByTestId('save-result').click();
    const title = 'e2e результат ' + Date.now();
    await page.getByPlaceholder('Название прогона').fill(title);
    await page.getByTestId('result-save-confirm').click();
    await expect(page.getByText('Результат сохранён')).toBeVisible({ timeout: 15000 });

    // Без активной стратегии результат попадает в группу «Без стратегии».
    const item = page.getByTestId('orphan-runs').locator('[data-testid="run-open"]').filter({ hasText: title });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.getByText('Сохранённый результат')).toBeVisible();
    await expect(page.locator('.research-output .rkit-kpi').first()).toBeVisible();

    const li = page.getByTestId('orphan-runs').locator('li').filter({ hasText: title });
    await li.getByRole('button', { name: 'Удалить прогон' }).click();
    await expect(page.getByText('Результат удалён')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('orphan-runs').locator('[data-testid="run-open"]').filter({ hasText: title })).toHaveCount(0);
  });

  test('сохранение → открытие → удаление СТРАТЕГИИ', async ({ page }) => {
    await fillSmallStrategy(page);

    await page.getByTestId('save-strategy').click();
    const title = 'e2e стратегия ' + Date.now();
    await page.getByTestId('strategy-title').fill(title);
    await page.getByTestId('strategy-save-confirm').click();
    await expect(page.getByText('Стратегия сохранена')).toBeVisible({ timeout: 15000 });
    // Стала активной (индикатор + кнопка обновления).
    await expect(page.getByTestId('update-strategy')).toBeVisible();

    // Появилась в библиотеке стратегий, открывается в редактор.
    const item = page.getByTestId('saved-strategies').locator('[data-testid="strategy-open"]').filter({ hasText: title });
    await expect(item).toBeVisible();
    await page.getByTestId('new-strategy').click(); // сбросить редактор
    await item.click();
    await expect(page.getByText('Стратегия открыта')).toBeVisible();
    await expect(page.getByTestId('strategy-code')).toContainText('UNIVERSE = ["AAA", "BBB", "CCC"]');

    // Удаление стратегии.
    const li = page.getByTestId('saved-strategies').locator('li').filter({ hasText: title }).first();
    await li.getByRole('button', { name: 'Удалить стратегию' }).first().click();
    await expect(page.getByText('Стратегия удалена')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('saved-strategies').locator('[data-testid="strategy-open"]').filter({ hasText: title })).toHaveCount(0);
  });
});
