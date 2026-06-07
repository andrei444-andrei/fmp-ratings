import { test, expect } from '@playwright/test';

// Смоук «Исследование трендов»: рендер, исполнение Python (Pyodide), сохранение
// промтов (обязательное название), результаты привязаны к промтам, описание (Markdown),
// редактирование и подгрузка входного промта при открытии результата.
// В e2e ключи отключены → базовый скрипт + синтетика, но Python исполняется по-настоящему.

async function savePrompt(page: import('@playwright/test').Page, text: string, title: string) {
  await page.locator('textarea').first().fill(text);
  await page.getByRole('button', { name: 'Сохранить промт' }).click();
  await page.getByPlaceholder(/Название/).fill(title);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Промт сохранён')).toBeVisible({ timeout: 15000 });
}

async function runOnce(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Исполнить' }).click();
  await expect(page.locator('.research-output .rtblwrap table')).toBeVisible({ timeout: 90000 });
}

test.describe('Research /research', () => {
  test('страница и пустое состояние рендерятся', async ({ page }) => {
    await page.goto('/research');
    await expect(page.getByRole('heading', { name: 'Запрос' })).toBeVisible();
    await expect(page.getByText('Здесь появится анализ')).toBeVisible();
  });

  test('без сохранённого промта результат сохранить нельзя (подсказка)', async ({ page }) => {
    await page.goto('/research');
    await page.locator('textarea').first().fill('доходность AAPL и MSFT за год');
    await runOnce(page);
    await expect(page.getByText('Сохраните промт, чтобы сохранить результат')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить результат' })).toHaveCount(0);
  });

  test('сохранение промта требует название и показывает его в списке', async ({ page }) => {
    await page.goto('/research');
    const title = 'e2e заголовок ' + Date.now();
    await page.locator('textarea').first().fill('промт для сохранения');
    await page.getByRole('button', { name: 'Сохранить промт' }).click();
    const saveBtn = page.getByRole('button', { name: 'Сохранить', exact: true });
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeDisabled();
    await page.getByPlaceholder(/Название/).fill(title);
    await saveBtn.click();
    await expect(page.getByText('Промт сохранён')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('li').getByText(title)).toBeVisible();
  });

  test('результат: сохранение с описанием, открытие подгружает промт', async ({ page }) => {
    await page.goto('/research');
    const ptitle = 'e2e desc ' + Date.now();
    const promptText = 'описательный промт ' + Date.now();
    await savePrompt(page, promptText, ptitle);
    await runOnce(page);
    // Сохранить результат с описанием (Markdown)
    await page.getByRole('button', { name: 'Сохранить результат' }).click();
    await page.getByPlaceholder(/Гипотеза/).fill('## Тест-логика\nПроверяем гипотезу');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Результат сохранён')).toBeVisible({ timeout: 15000 });
    // Сменить промт, затем открыть сохранённый результат — промт должен вернуться
    await page.locator('textarea').first().fill('совсем другой текст');
    const promptLi = page.getByTestId('saved-prompts').locator('> li').filter({ hasText: ptitle });
    await promptLi.locator('[data-testid="run-open"]').first().click();
    await expect(page.getByText('Сохранённый результат')).toBeVisible();
    await expect(page.locator('textarea').first()).toHaveValue(promptText);
    await expect(page.locator('.research-output .rdesc')).toContainText('Тест-логика');
  });

  test('редактирование описания результата', async ({ page }) => {
    await page.goto('/research');
    const ptitle = 'e2e edit ' + Date.now();
    await savePrompt(page, 'промт под редактирование ' + Date.now(), ptitle);
    await runOnce(page);
    await page.getByRole('button', { name: 'Сохранить результат' }).click();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Результат сохранён')).toBeVisible({ timeout: 15000 });
    // редактировать
    const promptLi = page.getByTestId('saved-prompts').locator('> li').filter({ hasText: ptitle });
    await promptLi.getByRole('button', { name: 'Редактировать результат' }).first().click();
    await page.getByPlaceholder(/Гипотеза/).fill('## Новое описание\nОбновлено');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Изменения сохранены')).toBeVisible({ timeout: 15000 });
    await promptLi.locator('[data-testid="run-open"]').first().click();
    await expect(page.locator('.research-output .rdesc')).toContainText('Новое описание');
  });

  test('главная страница ведёт на /research', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/research$/);
    await expect(page.getByRole('heading', { name: 'Запрос' })).toBeVisible();
  });

  test('удаление промта каскадно убирает его результат', async ({ page }) => {
    await page.goto('/research');
    const title = 'e2e casc ' + Date.now();
    await savePrompt(page, 'каскадный промт', title);
    await runOnce(page);
    await page.getByRole('button', { name: 'Сохранить результат' }).click();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Результат сохранён')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="run-open"]').filter({ hasText: title })).toBeVisible();
    const item = page.getByTestId('saved-prompts').locator('> li').filter({ hasText: title });
    await item.getByRole('button', { name: 'Удалить промт' }).click();
    await expect(page.getByText('Промт и его результаты удалены')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="run-open"]').filter({ hasText: title })).toHaveCount(0);
  });
});
