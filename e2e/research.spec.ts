import { test, expect } from '@playwright/test';

// Смоук «Исследование трендов»: рендер, исполнение Python (Pyodide),
// сохранение промта (обязательное название), привязка результата к промту.
// В e2e ключи отключены → базовый скрипт + синтетика, но Python исполняется по-настоящему.
test.describe('Research /research', () => {
  test('страница и пустое состояние рендерятся', async ({ page }) => {
    await page.goto('/research');
    await expect(page.getByRole('heading', { name: 'Запрос' })).toBeVisible();
    await expect(page.getByText('Здесь появится анализ')).toBeVisible();
  });

  test('без сохранённого промта результат сохранить нельзя (подсказка)', async ({ page }) => {
    await page.goto('/research');
    await page.locator('textarea').fill('доходность AAPL и MSFT за год');
    await page.getByRole('button', { name: 'Исполнить' }).click();
    await expect(page.locator('.research-output .rtblwrap table')).toBeVisible({ timeout: 90000 });
    await expect(page.getByText('Сохраните промт, чтобы сохранить результат')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить результат' })).toHaveCount(0);
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

  test('результат сохраняется после сохранения промта и открывается', async ({ page }) => {
    await page.goto('/research');
    await page.locator('textarea').fill('доходность QQQ за год');
    // 1) сначала сохранить промт
    await page.getByRole('button', { name: 'Сохранить промт' }).click();
    await page.getByPlaceholder(/Название/).fill('e2e QQQ ' + Date.now());
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Промт сохранён')).toBeVisible({ timeout: 15000 });
    // 2) запустить
    await page.getByRole('button', { name: 'Исполнить' }).click();
    await expect(page.locator('.research-output .rtblwrap table')).toBeVisible({ timeout: 90000 });
    // 3) теперь результат можно сохранить
    await page.getByRole('button', { name: 'Сохранить результат' }).click();
    await expect(page.getByText('Результат сохранён')).toBeVisible({ timeout: 15000 });
    // 4) открыть сохранённый результат
    await page.getByTestId('saved-runs').locator('button').first().click();
    await expect(page.getByText('Сохранённый результат')).toBeVisible();
  });
});
