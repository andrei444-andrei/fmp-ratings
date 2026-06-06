import { test, expect } from '@playwright/test';

// Смоук «Исследование трендов»: рендер, реальное исполнение Python (Pyodide),
// сохранение промта (с обязательным названием), сохранение и просмотр результата.
// В e2e ключи отключены → базовый скрипт + синтетика, но Python исполняется по-настоящему.
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
    await expect(page.locator('.research-output .rtblwrap table')).toBeVisible({ timeout: 90000 });
  });

  test('сохранение промта требует название и показывает его в списке', async ({ page }) => {
    await page.goto('/research');
    const title = 'e2e заголовок ' + Date.now();
    await page.locator('textarea').fill('промт для сохранения');
    await page.getByRole('button', { name: 'Сохранить промт' }).click();
    const saveBtn = page.getByRole('button', { name: 'Сохранить', exact: true });
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeDisabled(); // без названия нельзя
    await page.getByPlaceholder(/Название/).fill(title);
    await saveBtn.click();
    await expect(page.getByText('Промт сохранён')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('li').getByText(title)).toBeVisible();
  });

  test('сохранение результата и его просмотр', async ({ page }) => {
    await page.goto('/research');
    await page.locator('textarea').fill('доходность QQQ за год');
    await page.getByRole('button', { name: 'Исполнить' }).click();
    await expect(page.locator('.research-output .rtblwrap table')).toBeVisible({ timeout: 90000 });
    await page.getByRole('button', { name: 'Сохранить результат' }).click();
    await expect(page.getByText('Результат сохранён')).toBeVisible({ timeout: 15000 });
    // открыть первый сохранённый результат
    await page.getByTestId('saved-runs').locator('button').first().click();
    await expect(page.getByText('Сохранённый результат')).toBeVisible();
  });
});
