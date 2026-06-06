import { test, expect } from '@playwright/test';

// Смоук UX-кита: страница рендерится, интерактив (модалка/тост) работает.
// Прогоняется в двух проектах: desktop + mobile (см. playwright.config.ts).
test.describe('UX Kit /ui', () => {
  test('страница и ключевые секции рендерятся', async ({ page }) => {
    await page.goto('/ui');
    await expect(
      page.getByRole('heading', { name: 'Яркий UX-кит для финансовых рынков' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Палитра' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Кнопки' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Разместить заявку' })).toBeVisible();
  });

  test('модалка открывается и закрывается', async ({ page }) => {
    await page.goto('/ui');
    await page.getByRole('button', { name: 'Открыть модалку' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Подтвердите сделку')).toBeVisible();
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(dialog).toBeHidden();
  });

  test('тост появляется по клику', async ({ page }) => {
    await page.goto('/ui');
    await page.getByRole('button', { name: 'Toast: success' }).click();
    await expect(page.getByText('Сделка исполнена.')).toBeVisible();
  });
});
