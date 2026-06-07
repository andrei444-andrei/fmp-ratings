import { test, expect } from '@playwright/test';

// Смоук «Исследование трендов»: исследования (сохранённый запрос + его результаты),
// исполнение Python, сохранение результата внутри исследования (в т.ч. после правки промта),
// описание (Markdown), редактирование, каскадное удаление.
// В e2e ключи отключены → базовый скрипт + синтетика, но Python исполняется по-настоящему.

type Page = import('@playwright/test').Page;

async function saveStudy(page: Page, text: string, title: string) {
  await page.locator('textarea').first().fill(text);
  await page.getByRole('button', { name: 'Сохранить исследование' }).click();
  await page.getByPlaceholder(/Название/).fill(title);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Исследование сохранено')).toBeVisible({ timeout: 15000 });
}

async function runOnce(page: Page) {
  await page.getByRole('button', { name: 'Исполнить' }).click();
  await expect(page.locator('.research-output .rtblwrap table')).toBeVisible({ timeout: 90000 });
}

async function saveResult(page: Page) {
  await page.getByRole('button', { name: 'Сохранить результат' }).click();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Результат сохранён')).toBeVisible({ timeout: 15000 });
}

test.describe('Research /research', () => {
  test('страница и пустое состояние рендерятся', async ({ page }) => {
    await page.goto('/research');
    await expect(page.getByRole('heading', { name: 'Запрос' })).toBeVisible();
    await expect(page.getByText('Здесь появится анализ')).toBeVisible();
  });

  test('вне исследования результат сохранить нельзя (подсказка)', async ({ page }) => {
    await page.goto('/research');
    await page.locator('textarea').first().fill('доходность AAPL и MSFT за год');
    await runOnce(page);
    await expect(page.getByText('Создайте исследование, чтобы сохранить результат')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить результат' })).toHaveCount(0);
  });

  test('сохранение исследования требует название и показывает его в списке', async ({ page }) => {
    await page.goto('/research');
    const title = 'e2e заголовок ' + Date.now();
    await page.locator('textarea').first().fill('запрос для сохранения');
    await page.getByRole('button', { name: 'Сохранить исследование' }).click();
    const saveBtn = page.getByRole('button', { name: 'Сохранить', exact: true });
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeDisabled();
    await page.getByPlaceholder(/Название/).fill(title);
    await saveBtn.click();
    await expect(page.getByText('Исследование сохранено')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('li').getByText(title)).toBeVisible();
  });

  test('результат сохраняется ПОСЛЕ правки промта внутри исследования', async ({ page }) => {
    await page.goto('/research');
    await saveStudy(page, 'доходность QQQ за год', 'e2e study ' + Date.now());
    // правим промт — мы всё ещё внутри исследования
    await page.locator('textarea').first().fill('доходность QQQ за год и волатильность');
    await runOnce(page);
    await expect(page.getByRole('button', { name: 'Сохранить результат' })).toBeVisible();
    await saveResult(page);
  });

  test('результат: описание (Markdown) и подгрузка промта при открытии', async ({ page }) => {
    await page.goto('/research');
    const ptitle = 'e2e desc ' + Date.now();
    const promptText = 'описательный промт ' + Date.now();
    await saveStudy(page, promptText, ptitle);
    await runOnce(page);
    await page.getByRole('button', { name: 'Сохранить результат' }).click();
    await page.getByPlaceholder(/Гипотеза/).fill('## Тест-логика\nПроверяем гипотезу');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Результат сохранён')).toBeVisible({ timeout: 15000 });
    await page.locator('textarea').first().fill('совсем другой текст');
    const studyLi = page.getByTestId('saved-prompts').locator('> li').filter({ hasText: ptitle });
    await studyLi.locator('[data-testid="run-open"]').first().click();
    await expect(page.getByText('Сохранённый результат')).toBeVisible();
    await expect(page.locator('textarea').first()).toHaveValue(promptText);
    await expect(page.locator('.research-output .rdesc')).toContainText('Тест-логика');
  });

  test('главная страница ведёт на /research', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/research$/);
    await expect(page.getByRole('heading', { name: 'Запрос' })).toBeVisible();
  });

  test('удаление исследования каскадно убирает его результат', async ({ page }) => {
    await page.goto('/research');
    const title = 'e2e casc ' + Date.now();
    await saveStudy(page, 'каскадный запрос', title);
    await runOnce(page);
    await saveResult(page);
    await expect(page.locator('[data-testid="run-open"]').filter({ hasText: title })).toBeVisible();
    const item = page.getByTestId('saved-prompts').locator('> li').filter({ hasText: title });
    await item.getByRole('button', { name: 'Удалить исследование' }).click();
    await expect(page.getByText('Исследование и его результаты удалены')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="run-open"]').filter({ hasText: title })).toHaveCount(0);
  });
});
