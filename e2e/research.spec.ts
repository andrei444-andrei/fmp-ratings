import { test, expect } from '@playwright/test';

// Смоук «Исследование трендов»: рендер, реальное исполнение Python (Pyodide),
// сохранение промта. В e2e ключи отключены → базовый скрипт + синтетика,
// но Python исполняется по-настоящему и формирует таблицу result.
test.describe('Research /research', () => {
  test('страница и пустое состояние рендерятся', async ({ page }) => {
    await page.goto('/research');
    await expect(page.getByRole('heading', { name: 'Запрос' })).toBeVisible();
    await expect(page.getByText('Здесь появится анализ')).toBeVisible();
  });

  test('исполнение Python формирует таблицу результата', async ({ page }) => {
    await page.goto('/research');
    await page.locator('textarea').fill('доходность AAPL и MSFT за год');
    await page.getByRole('button', { name: 'Исполнить' }).click();
    await expect(page.getByText('Тикеры в анализе:')).toBeVisible({ timeout: 20000 });
    // Pyodide грузит ядро + pandas с CDN на первом прогоне — даём запас.
    await expect(page.locator('.research-output .rtblwrap table')).toBeVisible({ timeout: 90000 });
  });

  test('сохранение промта показывает его в списке', async ({ page }) => {
    await page.goto('/research');
    const text = 'e2e промт ' + Date.now();
    await page.locator('textarea').fill(text);
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Промт сохранён')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('li').getByText(text)).toBeVisible();
  });
});
