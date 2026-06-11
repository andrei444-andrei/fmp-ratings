import { test, expect } from '@playwright/test';

// Смоук «Исследование трендов»: исследования (сохранённый запрос + его результаты),
// исполнение Python, сохранение результата внутри исследования (в т.ч. после правки промта),
// описание (Markdown), редактирование, каскадное удаление.
// В e2e ключи отключены и дефолтного скрипта в продукте НЕТ — поэтому харнесс сам
// подкладывает готовый Python в тело запроса (флаг E2E_ALLOW_CODE на сервере),
// а Python исполняется по-настоящему на синтетических ценах.

type Page = import('@playwright/test').Page;

// Один DataFrame: доходность за период по тикерам.
const SINGLE_SCRIPT = `g = df.sort_values('date').groupby('symbol')['close']
ret = (g.last() / g.first() - 1) * 100
result = ret.round(2).rename('Доходность, %').reset_index().rename(columns={'symbol': 'Тикер'})
print('Доходность за период по тикерам:')
print(result.to_string(index=False))`;

// Многоэтапный результат: словарь именованных таблиц (рендерится отдельными блоками).
const MULTI_SCRIPT = `g = df.sort_values('date').groupby('symbol')['close']
ret = (g.last() / g.first() - 1) * 100
t1 = ret.round(2).rename('Доходность, %').reset_index().rename(columns={'symbol': 'Тикер'})
t2 = df.groupby('symbol').size().rename('Точек').reset_index().rename(columns={'symbol': 'Тикер'})
print('Готово:', len(t1), 'тикеров')
result = {'Этап 1 — доходность': t1, 'Этап 2 — объём данных': t2}`;

// Подменяем тело POST /execute, добавляя готовый Python (сервер примет его только под флагом).
async function stubExecute(page: Page, code: string) {
  await page.unroute('**/api/research/execute').catch(() => {});
  await page.route('**/api/research/execute', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    body.code = code;
    await route.continue({ postData: JSON.stringify(body) });
  });
}

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
  // По умолчанию исполняем простой одно-табличный скрипт.
  test.beforeEach(async ({ page }) => {
    await stubExecute(page, SINGLE_SCRIPT);
  });

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

  test('общий запрос «по странам» подставляет корзину страновых ETF', async ({ page }) => {
    await stubExecute(page, SINGLE_SCRIPT);
    await page.goto('/research');
    await page.locator('textarea').first().fill('сравни среднюю доходность по странам за всё время');
    await page.getByRole('button', { name: 'Исполнить' }).click();
    const lead = page.locator('.research-output .rlead');
    await expect(lead).toContainText('EWJ', { timeout: 30000 });
    await expect(lead).toContainText('EWG'); // корзина, а не дефолтная пара SPY/QQQ
  });

  test('ask_ai подключён: без ключа даёт понятную ошибку', async ({ page }) => {
    // Мост ask_ai существует (нет NameError) и без AIMLAPI_KEY отдаёт внятную причину.
    await stubExecute(page, 'x = await ask_ai("привет")\nresult = x');
    await page.goto('/research');
    await page.locator('textarea').first().fill('тест ask_ai');
    await page.getByRole('button', { name: 'Исполнить' }).click();
    const err = page.locator('.research-output .rerrblk');
    await expect(err).toBeVisible({ timeout: 90000 });
    await expect(err).toContainText('ask_ai');
  });

  test('многоэтапный результат рисует несколько подписанных таблиц', async ({ page }) => {
    await stubExecute(page, MULTI_SCRIPT);
    await page.goto('/research');
    await page.locator('textarea').first().fill('многоэтапный анализ AAPL и MSFT');
    await page.getByRole('button', { name: 'Исполнить' }).click();
    await expect(page.getByText('Этап 1 — доходность')).toBeVisible({ timeout: 90000 });
    await expect(page.getByText('Этап 2 — объём данных')).toBeVisible();
    await expect(page.locator('.research-output .rtblwrap table')).toHaveCount(2);
  });
});
