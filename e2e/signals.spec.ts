import { test, expect } from '@playwright/test';

// Смоук «Модель сигналов» (/signals): 3 режима исследования на детерминированном Python-движке,
// исполняемом ПО-НАСТОЯЩЕМУ на синтетических ценах (без ключей). Проверяем интерактив:
// свип фактора → карта + drill-down + сохранение сигнала; событийный анализ сигнала;
// комбинация двух сигналов с walk-forward автоподбором.

type Page = import('@playwright/test').Page;

// Узкая вселенная (быстрый прогон на синтетике).
async function setup(page: Page) {
  await page.goto('/signals');
  await page.getByRole('button', { name: 'Широкая' }).click(); // выключаем дефолтный широкий пресет
  await page.getByPlaceholder('SMH, GLD, TLT').fill('AAA, BBB, CCC, DDD, EEE, FFF');
}

test.describe('Signals /signals', () => {
  test('пустое состояние и вкладки рендерятся', async ({ page }) => {
    await page.goto('/signals');
    await expect(page.getByRole('heading', { name: 'Данные' })).toBeVisible();
    await expect(page.getByTestId('tab-factor')).toBeVisible();
    await expect(page.getByText('Здесь появится результат')).toBeVisible();
  });

  test('режим Фактор: карта строится, клик по ячейке раскрывает детали, сигнал сохраняется', async ({ page }) => {
    await setup(page);
    await page.getByTestId('run-study').click();
    // Карта (тепловые ячейки) появляется.
    const cells = page.getByTestId('heat-cell');
    await expect(cells.first()).toBeVisible({ timeout: 150000 });
    expect(await cells.count()).toBeGreaterThan(1);
    // Клик по ячейке → панель деталей: по годам + по тикерам + кнопка сохранения.
    await cells.first().click();
    const saveBtn = page.getByRole('button', { name: 'Сохранить как сигнал' });
    await expect(saveBtn).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Изменение по годам (ср. изб. дох.)')).toBeVisible();
    await expect(page.getByText('По тикерам', { exact: true })).toBeVisible();
    await saveBtn.click();
    await expect(page.getByText('Сигнал сохранён')).toBeVisible({ timeout: 15000 });
  });

  test('режим Фактор: диапазоны (от–до) строят непересекающиеся корзины', async ({ page }) => {
    await setup(page);
    await page.getByRole('button', { name: 'Диапазоны (от–до)' }).click();
    await page.getByTestId('run-study').click();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 150000 });
    await expect(page.locator('[data-testid="signals-output"]').getByText(/диапазон/i).first()).toBeVisible();
  });

  test('режим Сигнал: событийный анализ рендерит статистику', async ({ page }) => {
    await setup(page);
    await page.getByTestId('tab-signal').click();
    await page.getByTestId('run-study').click();
    // Появляется блок статистики (метки Stat-карточек) или сообщение о малой выборке.
    await expect(
      page.locator('[data-testid="signals-output"]').getByText(/Ср\. изб\. дох\.|Слишком мало событий/),
    ).toBeVisible({ timeout: 150000 });
  });

  test('режим Комбинация: автоподбор по двум сигналам (IS vs OOS)', async ({ page }) => {
    await setup(page);
    // Создаём два различных сигнала во вкладке «Сигнал».
    await page.getByTestId('tab-signal').click();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Сигнал сохранён')).toBeVisible({ timeout: 15000 });
    // Меняем порог и сохраняем второй (другое определение).
    await page.locator('#sthr').fill('-10');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Сигнал сохранён')).toBeVisible({ timeout: 15000 });

    // Переходим в комбинацию, выбираем оба сигнала.
    await page.getByTestId('tab-combine').click();
    const picks = page.getByTestId('combine-signals').locator('button');
    await picks.nth(0).click();
    await picks.nth(1).click();
    await page.getByTestId('run-study').click();
    // Результат: пересечение + автоподбор (или явное «коротко для walk-forward»).
    await expect(
      page.locator('[data-testid="signals-output"]').getByText(/Пересечение|Автоподбор/).first(),
    ).toBeVisible({ timeout: 150000 });
  });
});
