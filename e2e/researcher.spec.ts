import { test, expect } from '@playwright/test';

// Скринер (/researcher): движок отдаёт ПАНЕЛЬ СДЕЛОК (по-настоящему, на синтетике без ключей),
// условия/разрезы/провал считаются на клиенте. Проверяем сквозной путь.

test.describe('Скринер /researcher', () => {
  test('панель грузится, таблица по тикерам/годам, провал в сделки', async ({ page }) => {
    await page.goto('/researcher');
    await expect(page.getByRole('heading', { name: 'Скринер' })).toBeVisible();
    // Панель сделок подтягивается автоматически (синтетика) → в результатах появляется мета-строка.
    await expect(page.getByText(/Панель:.*сделок/)).toBeVisible({ timeout: 120000 });

    // Дефолтный вид — «Сводно» (консолидированная статистика, без таблицы). Переключаемся на таблицу тикеров.
    await page.getByRole('button', { name: 'По тикерам' }).click();

    // Убираем условия (удаляем блок) → показываются ВСЕ сделки → строки тикеров.
    await page.getByText('удалить блок').click();
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(1);

    // Разрез по годам.
    await page.getByRole('button', { name: 'По годам' }).click();
    await expect(page.locator('table tbody tr').first()).toBeVisible();

    // Назад по тикерам → провал в сделки по клику на строку.
    await page.getByRole('button', { name: 'По тикерам' }).click();
    await page.locator('table tbody tr').first().click();
    await expect(page.getByText('матч-сделки по текущим условиям')).toBeVisible();
  });
});
