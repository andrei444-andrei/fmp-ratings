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
  await expect(page.locator('.research-output table.rkit-table')).toBeVisible({ timeout: 90000 });
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

  test('ask_ai: top-level await возвращает текст в результат', async ({ page }) => {
    await stubExecute(
      page,
      'import pandas as pd\nout = await ask_ai("Новости по рынку", web=True)\nresult = pd.DataFrame({"Ответ": [out]})',
    );
    await page.goto('/research');
    await page.locator('textarea').first().fill('тест ask_ai');
    await page.getByRole('button', { name: 'Исполнить' }).click();
    // Заглушка моста под флагом e2e возвращает маркер [AI:…] — путь ask_ai → результат рабочий.
    await expect(page.locator('.research-output table.rkit-table')).toContainText('[AI:default:web]', { timeout: 90000 });
  });

  test('emit: поэтапный вывод блоков по ходу скрипта', async ({ page }) => {
    await stubExecute(
      page,
      'import pandas as pd\n' +
        "emit(kpi('Этап 1', 'готов'))\n" +
        "emit(pd.DataFrame({'A': [1, 2], 'B': [-3.5, 4.0]}))\n" +
        "emit(callout('Готово', tone='good', title='Статус'))\n" +
        'result = None',
    );
    await page.goto('/research');
    await page.locator('textarea').first().fill('тест emit');
    await page.getByRole('button', { name: 'Исполнить' }).click();
    await expect(page.locator('.research-output .rkit-kpi')).toContainText('Этап 1', { timeout: 90000 });
    await expect(page.locator('.research-output table.rkit-table')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.research-output .rkit-callout')).toContainText('Готово', { timeout: 30000 });
    // result=None → финальный рендер ничего не дублирует: ровно один kpi и один callout.
    await expect(page.locator('.research-output .rkit-kpi')).toHaveCount(1);
    await expect(page.locator('.research-output .rkit-callout')).toHaveCount(1);
  });

  test('ask_ai_many: параллельный батч возвращает ответы по порядку', async ({ page }) => {
    await stubExecute(
      page,
      'import pandas as pd\n' +
        'prompts = ["q0", "q1", "q2", "q3", "q4"]\n' +
        'answers = await ask_ai_many(prompts, web=True, concurrency=3)\n' +
        'result = pd.DataFrame({"Запрос": prompts, "Ответ": answers})',
    );
    await page.goto('/research');
    await page.locator('textarea').first().fill('тест ask_ai_many');
    await page.getByRole('button', { name: 'Исполнить' }).click();
    const tbl = page.locator('.research-output table.rkit-table');
    await expect(tbl).toContainText('[AI:default:web] q0', { timeout: 90000 });
    await expect(tbl).toContainText('[AI:default:web] q4');
    await expect(tbl.locator('tbody tr')).toHaveCount(5, { timeout: 30000 });
  });

  test('asyncio.run переписывается на top-level await (без stack switching)', async ({ page }) => {
    await stubExecute(
      page,
      'import asyncio, pandas as pd\nasync def main():\n    return await ask_ai("hi")\nout = asyncio.run(main())\nresult = pd.DataFrame({"Ответ": [out]})',
    );
    await page.goto('/research');
    await page.locator('textarea').first().fill('тест async driver');
    await page.getByRole('button', { name: 'Исполнить' }).click();
    // Результат дошёл до ask_ai (нет ошибки stack switching), а в коде нет блокирующего asyncio.run.
    await expect(page.locator('.research-output table.rkit-table')).toContainText('[AI:', { timeout: 90000 });
    await expect(page.locator('.research-output .rcode')).toContainText('await main()');
    await expect(page.locator('.research-output .rcode')).not.toContainText('asyncio.run(');
  });

  test('проценты: рост зелёным, падение красным (единый стиль движка)', async ({ page }) => {
    await stubExecute(
      page,
      'import pandas as pd\nresult = pd.DataFrame({"Период": ["A", "B"], "Моментум, %": [-41.42, 3.1]})',
    );
    await page.goto('/research');
    await page.locator('textarea').first().fill('тест окраски чисел');
    await page.getByRole('button', { name: 'Исполнить' }).click();
    // pct-колонка: движок добавил знак/% и покрасил по знаку.
    await expect(page.locator('.research-output table.rkit-table td.rt-neg')).toContainText('-41.42%', { timeout: 90000 });
    await expect(page.locator('.research-output table.rkit-table td.rt-pos')).toContainText('+3.10%');
  });

  test('table(heat=...) красит значения единой палитрой (heatmap-пресет)', async ({ page }) => {
    await stubExecute(
      page,
      'import pandas as pd\n' +
        "df = pd.DataFrame({'Страна': ['BR', 'JP', 'CN'], 'CAGR, %': [18.4, 2.1, -9.8]})\n" +
        "result = table(df, heat='CAGR, %', title='Тепловая карта')",
    );
    await page.goto('/research');
    await page.locator('textarea').first().fill('тест heat');
    await page.getByRole('button', { name: 'Исполнить' }).click();
    const tbl = page.locator('.research-output table.rkit-table');
    await expect(tbl).toBeVisible({ timeout: 90000 });
    // heat-колонка получила инлайн-фон единой палитры (rgba), заголовок таблицы виден.
    await expect(tbl.locator('td[style*="rgba"]').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.research-output .rt-cap')).toContainText('Тепловая карта');
  });

  test('таблица устойчива к NaN/inf: не падает, плохие значения как «—»', async ({ page }) => {
    await stubExecute(
      page,
      "import pandas as pd, numpy as np\n" +
        "result = pd.DataFrame({'Тикер': ['A', 'B', 'C'], 'CAGR, %': [12.3, float('inf'), np.nan]})",
    );
    await page.goto('/research');
    await page.locator('textarea').first().fill('тест устойчивости');
    await page.getByRole('button', { name: 'Исполнить' }).click();
    await expect(page.locator('.research-output table.rkit-table')).toBeVisible({ timeout: 90000 });
    // inf и NaN → «—», таблица не падает и нет карточки ошибки
    await expect(page.locator('.research-output table.rkit-table td.rt-muted')).toHaveCount(2, { timeout: 30000 });
    await expect(page.locator('.research-output .rerrblk')).toHaveCount(0);
  });

  test('длинный текст в ячейке рендерится как markdown (rich cell)', async ({ page }) => {
    await stubExecute(
      page,
      'import pandas as pd\n' +
        "txt = '**Глобальный кризис 2008**: после краха Lehman Brothers внешнее финансирование " +
        "резко сократилось, паника на рынках и отток капитала; восстановление весной 2009 — длинный текст для проверки переноса.'\n" +
        "result = pd.DataFrame({'Страна': ['Бразилия'], 'Мин. моментум, %': [-41.16], 'Новости (RU)': [txt]})",
    );
    await page.goto('/research');
    await page.locator('textarea').first().fill('тест rich-ячейки');
    await page.getByRole('button', { name: 'Исполнить' }).click();
    const rich = page.locator('.research-output table.rkit-table td.rt-rich');
    await expect(rich).toBeVisible({ timeout: 90000 });
    await expect(rich.locator('strong')).toContainText('Глобальный кризис 2008'); // markdown отрендерен
    await expect(rich).not.toContainText('**'); // не сырой markdown
    await expect(page.locator('.research-output table.rkit-table td.rt-neg')).toContainText('-41.16%');
  });

  test('UX-кит: kpi/bars/callout рендерятся вместе с таблицей', async ({ page }) => {
    await stubExecute(
      page,
      'import pandas as pd\n' +
        "df = pd.DataFrame({'Тикер': ['EWZ', 'EWJ'], 'Доходность, %': [12.3, -4.5]})\n" +
        "result = [row(kpi('CAGR', '11.5%', '+2.1%'), kpi('Просадка', '-41%')), " +
        "bars({'EWZ': 12.3, 'EWJ': -4.5}, title='Рейтинг'), df, " +
        "callout('Демо-данные', tone='warn', title='Внимание')]",
    );
    await page.goto('/research');
    await page.locator('textarea').first().fill('тест ux-кит');
    await page.getByRole('button', { name: 'Исполнить' }).click();
    await expect(page.locator('.research-output .rkit-kpi').first()).toBeVisible({ timeout: 90000 });
    await expect(page.locator('.research-output .rkit-bars')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.research-output .rkit-callout')).toContainText('Демо-данные', { timeout: 30000 });
    await expect(page.locator('.research-output table.rkit-table')).toBeVisible({ timeout: 30000 });
  });

  test('многоэтапный результат рисует несколько подписанных таблиц', async ({ page }) => {
    await stubExecute(page, MULTI_SCRIPT);
    await page.goto('/research');
    await page.locator('textarea').first().fill('многоэтапный анализ AAPL и MSFT');
    await page.getByRole('button', { name: 'Исполнить' }).click();
    // Подписи именно у таблиц результата (.rcap), а не в подсвеченном блоке кода.
    await expect(page.locator('.research-output .rcap', { hasText: 'Этап 1 — доходность' })).toBeVisible({ timeout: 90000 });
    await expect(page.locator('.research-output .rcap', { hasText: 'Этап 2 — объём данных' })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.research-output table.rkit-table')).toHaveCount(2, { timeout: 30000 });
  });
});
