import { test, expect } from '@playwright/test';

// Раздел «Анализ тикера» (/ticker): сервер отдаёт панель одного тикера (по-настоящему, на синтетике без
// ключей), бины/условия/статистика считаются на клиенте. Проверяем сквозной путь и настройки бинов.

test.describe('Анализ тикера /ticker', () => {
  test('панель грузится, виджеты, настройка бинов, провал в детали, смена тикера', async ({ page }, testInfo) => {
    // Детальные взаимодействия проверяем на desktop; мобайл покрыт отдельным тестом видимости
    // (на мобильном фикс-навбар перехватывает программный клик после scroll-to-top).
    test.skip(testInfo.project.name === 'mobile', 'детальные взаимодействия — на desktop');
    await page.goto('/ticker');
    await expect(page.getByRole('heading', { name: /Анализ тикера/ })).toBeVisible();

    // Панель подтягивается автоматически (синтетика) → появляются виджеты и карточки состояния.
    const widget = page.locator('.tk .widgets > .card').first();
    await expect(widget).toBeVisible({ timeout: 120000 });
    expect(await page.locator('.tk .grid-state .stat').count()).toBe(5);
    expect(await page.locator('.tk .widgets tr.bin').count()).toBeGreaterThan(1);

    // Настройка границ: открыть ⚙ первого виджета и переключить режим бинов на «Квантили».
    await widget.locator('.gear').click();
    await expect(page.locator('.tk .cfg').first()).toBeVisible();
    await page.getByRole('button', { name: 'Квантили' }).click();
    await expect(page.locator('.tk .widgets tr.bin').first()).toBeVisible();

    // Провал в бин → детали (decay по горизонтам + похожие эпизоды).
    await page.locator('.tk .widgets tr.bin').first().click();
    await expect(page.locator('.tk .decay').first()).toBeVisible();

    // Смена тикера через быстрый чип → виджеты пересобираются.
    await page.getByRole('button', { name: 'KO', exact: true }).click();
    await expect(page.locator('.tk .widgets > .card').first()).toBeVisible({ timeout: 120000 });

    // Корреляции: настраиваемый набор активов.
    await expect(page.locator('.tk .assets .asset').first()).toBeVisible();
  });

  test('мобильный вьюпорт: заголовок и виджеты видны', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ticker');
    await expect(page.getByRole('heading', { name: /Анализ тикера/ })).toBeVisible();
    await expect(page.locator('.tk .widgets > .card').first()).toBeVisible({ timeout: 120000 });
  });
});
