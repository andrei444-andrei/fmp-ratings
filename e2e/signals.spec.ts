import { test, expect } from '@playwright/test';

// Смоук «Модель сигналов» (/signals): детерминированный Python-движок факторной модели
// исполняется ПО-НАСТОЯЩЕМУ на синтетических ценах (без ключей FMP/AIMLAPI). Проверяем,
// что отчёт собирается (сводка, таблицы, веса, live-скоринг) без карточек ошибок, и что
// прогон сохраняется/открывается/удаляется.

type Page = import('@playwright/test').Page;

// Сужаем вселенную до 6 синтетических тикеров — чтобы прогон уложился в таймаут.
async function buildSmallModel(page: Page) {
  await page.goto('/signals');
  // Выключаем широкий пресет (он включён по умолчанию) → останется только наш кастом.
  await page.getByRole('button', { name: 'Широкая' }).click();
  await page.getByPlaceholder(/SMH/).fill('AAA, BBB, CCC, DDD, EEE, FFF');
  await page.getByTestId('run-signals').click();
}

test.describe('Signals /signals', () => {
  test('страница и пустое состояние рендерятся', async ({ page }) => {
    await page.goto('/signals');
    await expect(page.getByRole('heading', { name: 'Конфигурация' })).toBeVisible();
    await expect(page.getByText('Здесь появится отчёт модели')).toBeVisible();
    await expect(page.getByTestId('run-signals')).toBeVisible();
  });

  test('строит факторную модель и рендерит отчёт без ошибок', async ({ page }) => {
    await buildSmallModel(page);
    // Сводка (kpi-карточки) и хотя бы одна таблица движка появляются по ходу исполнения.
    await expect(page.locator('.research-output .rkit-kpi').first()).toBeVisible({ timeout: 150000 });
    await expect(page.locator('.research-output table.rkit-table').first()).toBeVisible({ timeout: 60000 });
    // Ключевые секции отчёта.
    await expect(page.locator('.research-output .rt-cap', { hasText: 'Одиночные факторы' })).toBeVisible({ timeout: 60000 });
    await expect(page.locator('.research-output .rt-cap', { hasText: 'Live-скоринг' })).toBeVisible({ timeout: 60000 });
    // Ни одной карточки ошибки.
    await expect(page.locator('.research-output .rerrblk')).toHaveCount(0);
  });

  test('сохранение → открытие → удаление прогона', async ({ page }) => {
    await buildSmallModel(page);
    await expect(page.locator('.research-output table.rkit-table').first()).toBeVisible({ timeout: 150000 });

    await page.getByRole('button', { name: 'Сохранить результат' }).click();
    const title = 'e2e сигналы ' + Date.now();
    await page.getByPlaceholder('Название прогона').fill(title);
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Результат сохранён')).toBeVisible({ timeout: 15000 });

    // Прогон появился в списке — открываем его.
    const item = page.getByTestId('saved-runs').locator('[data-testid="run-open"]').filter({ hasText: title });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.getByText('Сохранённый результат')).toBeVisible();
    await expect(page.locator('.research-output table.rkit-table').first()).toBeVisible();

    // Удаляем.
    const li = page.getByTestId('saved-runs').locator('li').filter({ hasText: title });
    await li.getByRole('button', { name: 'Удалить прогон' }).click();
    await expect(page.getByText('Результат удалён')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('saved-runs').locator('[data-testid="run-open"]').filter({ hasText: title })).toHaveCount(0);
  });
});
