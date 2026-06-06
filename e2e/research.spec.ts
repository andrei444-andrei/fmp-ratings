import { test, expect } from '@playwright/test';

// Смоук страницы «Исследование трендов»: рендер, стриминг результата, сохранение промта.
// Без ключей (FMP/AIMLAPI) исполнение использует синтетику — поток всё равно идёт.
test.describe('Research /research', () => {
  test('страница и пустое состояние рендерятся', async ({ page }) => {
    await page.goto('/research');
    await expect(page.getByRole('heading', { name: 'Запрос' })).toBeVisible();
    await expect(page.getByText('Здесь появится анализ')).toBeVisible();
  });

  test('исполнение стримит блоки результата', async ({ page }) => {
    await page.goto('/research');
    await page.locator('textarea').fill('сравни доходность AAPL и MSFT за год');
    await page.getByRole('button', { name: 'Исполнить' }).click();
    await expect(page.getByText('Тикеры в анализе:')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Тренды за 12 месяцев')).toBeVisible({ timeout: 20000 });
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
