import { test, expect } from '@playwright/test';

// Смоук «Переключение A/B» (/switch): пара A/B, цель = форвардная доходность A − B. Движок —
// детерминированный Python (Pyodide) на СИНТЕТИЧЕСКИХ ценах (без ключей). Проверяем оба режима:
// авто-скан связей (holdout-OOS + FDR) и ручной свип фактора (карта период × порог).

type Page = import('@playwright/test').Page;

// Синтетические тикеры → провайдер без ключей отдаёт детерминированную синтетику (не реальные данные).
async function setPair(page: Page) {
  await page.getByTestId('inp-a').fill('AAA');
  await page.getByTestId('inp-b').fill('BBB');
  await page.getByTestId('inp-market').fill('CCC');
}

test.describe('Switch /switch', () => {
  test('пустое состояние и переключение режимов', async ({ page }) => {
    await page.goto('/switch');
    await expect(page.getByRole('heading', { name: /Переключение/ })).toBeVisible();
    await expect(page.getByTestId('inp-a')).toBeVisible();
    await expect(page.getByTestId('switch-output')).toContainText('Здесь появится результат');
    // По умолчанию режим «Авто»; кнопка зовёт сканировать связи.
    await expect(page.getByTestId('run-switch')).toContainText('Сканировать связи');
    // Переключение на «Вручную» меняет призыв кнопки.
    await page.getByRole('tab', { name: /Вручную/ }).click();
    await expect(page.getByTestId('run-switch')).toContainText('Построить карту');
  });

  test('авто-скан: считает связи и честно показывает итог (правила или их отсутствие)', async ({ page }) => {
    await page.goto('/switch');
    await setPair(page);
    await page.getByTestId('run-switch').click();
    // Результат авто-скана появляется (заголовок «Связи: A vs B»).
    const res = page.getByTestId('switch-auto-result');
    await expect(res).toBeVisible({ timeout: 180000 });
    await expect(res).toContainText('AAA');
    await expect(res).toContainText('BBB');
    // Скан реально перебрал условия — счётчик присутствует.
    await expect(res).toContainText('просканировано условий');
    // Итог честный: либо есть карточки правил, либо явный блок «устойчивых правил не найдено».
    const rules = page.getByTestId('switch-rule');
    const empty = page.getByTestId('switch-auto-empty');
    await expect(async () => {
      expect((await rules.count()) + (await empty.count())).toBeGreaterThan(0);
    }).toPass({ timeout: 5000 });
  });

  test('ручной свип: строит карту период × порог', async ({ page }) => {
    await page.goto('/switch');
    await setPair(page);
    await page.getByRole('tab', { name: /Вручную/ }).click();
    // Фактор «Волатильность» на субъекте «Рынок», сторона ≥ порог — карта A − B.
    await page.getByTestId('sel-factor').selectOption('vol');
    await page.getByTestId('run-switch').click();
    const grid = page.getByTestId('switch-grid');
    await expect(grid).toBeVisible({ timeout: 180000 });
    // В таблице есть строки периодов и ячейки доходности.
    await expect(page.getByTestId('switch-manual-result')).toContainText('База');
    const cellCount = await grid.locator('tbody td').count();
    expect(cellCount).toBeGreaterThan(1);
  });
});
