import { test, expect } from '@playwright/test';

// Смоук «Модель сигналов» (/signals): 3 режима исследования на детерминированном Python-движке,
// исполняемом ПО-НАСТОЯЩЕМУ на синтетических ценах (без ключей). Проверяем интерактив:
// свип фактора → карта + drill-down + сохранение сигнала; событийный анализ сигнала;
// комбинация двух сигналов с walk-forward автоподбором.

type Page = import('@playwright/test').Page;

// Узкая вселенная (быстрый прогон на синтетике). Пресеты по умолчанию НЕ выбраны.
async function setup(page: Page) {
  await page.goto('/signals');
  await page.getByPlaceholder('SMH, GLD, TLT').fill('AAA, BBB, CCC, DDD, EEE, FFF');
}

test.describe('Signals /signals', () => {
  test('пустое состояние; вселенная не выбрана по умолчанию (запуск заблокирован)', async ({ page }) => {
    await page.goto('/signals');
    await expect(page.getByRole('heading', { name: 'Данные' })).toBeVisible();
    await expect(page.getByTestId('tab-factor')).toBeVisible();
    await expect(page.getByText('Здесь появится результат')).toBeVisible();
    // Вселенная пуста → подсказка видна, кнопка запуска заблокирована.
    await expect(page.getByText(/Выберите вселенную/)).toBeVisible();
    await expect(page.getByTestId('run-study')).toBeDisabled();
  });

  test('разные классы активов — отдельные таблицы (металлы + сырьё)', async ({ page }) => {
    await page.goto('/signals');
    await page.getByRole('button', { name: 'Металлы', exact: true }).click();
    await page.getByRole('button', { name: 'Сырьё (commodities)', exact: true }).click();
    await page.getByTestId('run-study').click();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 150000 });
    const out = page.locator('[data-testid="signals-output"]');
    // Метки групп встречаются и в лидерборде, и в заголовках таблиц — достаточно, что присутствуют.
    await expect(out.getByText('Металлы', { exact: true }).first()).toBeVisible();
    await expect(out.getByText('Сырьё (commodities)', { exact: true }).first()).toBeVisible();
  });

  test('кросс-страновой лидерборд: ранжирует группы и реагирует на выбор столбца/сортировки', async ({ page }) => {
    await page.goto('/signals');
    await page.getByRole('button', { name: 'Металлы', exact: true }).click();
    await page.getByRole('button', { name: 'Сырьё (commodities)', exact: true }).click();
    await page.getByTestId('run-study').click();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 150000 });
    // Лидерборд: таблица с двумя строками (две группы) + переключатели столбца/периода/сортировки.
    const lb = page.getByTestId('leaderboard');
    await expect(lb).toBeVisible();
    await expect(page.getByTestId('leaderboard-row')).toHaveCount(2);
    await expect(page.getByText('Сильнее всего:')).toBeVisible();
    // Регресс: выбор столбца через <select> (значение — строка, а пороги числа) РАНЬШЕ обнулял
    // данные. Тот же столбец через select должен сохранять строку-итог.
    await page.getByTestId('leaderboard-col').selectOption({ index: 0 });
    await expect(page.getByText('Сильнее всего:')).toBeVisible();
    // Выбор конкретного периода (не «лучший») и сортировки — структура сохраняется.
    await page.getByTestId('leaderboard-param').selectOption({ index: 1 });
    await expect(page.getByTestId('leaderboard-row')).toHaveCount(2);
    await page.getByRole('button', { name: 'по доходности' }).click();
    await expect(page.getByTestId('leaderboard-row')).toHaveCount(2);
  });

  test('режим Фактор: карта строится, клик по ячейке раскрывает детали, сигнал сохраняется', async ({ page }) => {
    await setup(page);
    // Окно дат (годы от-до) и пропуск последних дней (gap) в моментуме/превышении.
    await page.locator('#yf').selectOption('2016');
    await page.locator('#fskip').fill('5');
    await page.getByTestId('run-study').click();
    // Карта (тепловые ячейки) появляется.
    const cells = page.getByTestId('heat-cell');
    await expect(cells.first()).toBeVisible({ timeout: 150000 });
    expect(await cells.count()).toBeGreaterThan(1);
    // Клик по ячейке → панель деталей: по годам + по тикерам + кнопка сохранения.
    await cells.first().click();
    const saveBtn = page.getByRole('button', { name: 'Сохранить как сигнал' });
    await expect(saveBtn).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Профиль по горизонтам: накопленная изб. дох. (дн.)')).toBeVisible();
    await expect(page.getByText('Изменение по годам (ср. изб. дох.)')).toBeVisible();
    await expect(page.getByText('По тикерам', { exact: true })).toBeVisible();
    // Сдвиг окна лет НА результате → метрики пересчитываются без повторного прогона (заголовок ячейки показывает окно).
    await page.locator('[data-testid="win-from"]').evaluate((el: any, val) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, String(val));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, 2024);
    await expect(page.locator('[data-testid="signals-output"]').getByText(/2024[–-]/).first()).toBeVisible();
    await saveBtn.click();
    await expect(page.getByText('Сигнал сохранён')).toBeVisible({ timeout: 15000 });
  });

  test('дрилл-даун по году: клик по году в «Изменение по годам» раскрывает случаи по датам (cellobs)', async ({ page }) => {
    await setup(page);
    await page.getByTestId('run-study').click();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 150000 });
    // Открываем детали ячейки → видим «Изменение по годам».
    await page.getByTestId('heat-cell').first().click();
    const out = page.locator('[data-testid="signals-output"]');
    const yearRow = out.getByTestId('yearly-row').first();
    await expect(yearRow).toBeVisible({ timeout: 30000 });
    await yearRow.click();
    // Появляется панель случаев; после серверного пересчёта — таблица случаев ИЛИ «нет случаев», без ошибок.
    const drill = out.getByTestId('cellobs');
    await expect(drill).toBeVisible();
    await expect(drill.getByText(/Случаи за \d{4}/)).toBeVisible();
    await expect(drill.getByText('Считаю случаи по датам…')).toHaveCount(0, { timeout: 150000 });
    await expect(drill.getByText('Не удалось определить тикеры группы')).toHaveCount(0);
    await expect(drill.locator('table tbody tr').or(drill.getByText('Нет случаев за этот год')).first()).toBeVisible({ timeout: 30000 });
  });

  test('последний результат переживает перезаход во вкладку (авто-восстановление)', async ({ page }) => {
    await setup(page);
    await page.getByTestId('run-study').click();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 150000 });
    // Перезаходим во вкладку — карта должна восстановиться без повторного прогона.
    await page.reload();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 30000 });
  });

  test('сохранение со своим именем, переименование, перезагрузка и открытие из БД (gzip-снимок)', async ({ page }) => {
    await setup(page);
    await page.getByTestId('run-study').click();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 150000 });
    // Сохранение со СВОИМ названием (двухшаговый ввод имени).
    await page.getByTestId('save-result-btn').click();
    await page.getByTestId('save-name-input').fill('Мой моментум-тест');
    await page.getByTestId('save-name-confirm').click();
    await expect(page.getByText('Результат сохранён')).toBeVisible({ timeout: 15000 });
    const list = page.getByTestId('saved-results');
    await expect(list.getByText('Мой моментум-тест', { exact: true })).toBeVisible();
    // Переименование в списке.
    await list.getByTestId('result-rename').first().click();
    await page.getByTestId('result-rename-input').fill('Переименованный');
    await page.keyboard.press('Enter');
    await expect(list.getByText('Переименованный', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(list.getByText('Мой моментум-тест', { exact: true })).toHaveCount(0);
    // Перезагрузка → имя и снимок остаются в БД, открывается (распаковка gzip-payload).
    await page.reload();
    await expect(list.getByText('Переименованный', { exact: true })).toBeVisible({ timeout: 30000 });
    await list.getByTestId('result-open').first().click();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 30000 });
  });

  test('пермалинк: сохранение даёт ?result=<id>; прямой переход открывает снимок (без localStorage)', async ({ page, baseURL }) => {
    await setup(page);
    await page.getByTestId('run-study').click();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 150000 });
    // Сохраняем → в адресной строке появляется ?result=<id>, в шапке — кнопка «🔗 Ссылка».
    await page.getByTestId('save-result-btn').click();
    await page.getByTestId('save-name-input').fill('Пермалинк-тест');
    await page.getByTestId('save-name-confirm').click();
    await expect(page.getByText('Результат сохранён')).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/[?&]result=\d+/);
    await expect(page.getByTestId('result-copy-link')).toBeVisible();
    const id = new URL(page.url()).searchParams.get('result');
    expect(id).toBeTruthy();

    // Открываем ссылку в ЧИСТОМ контексте (нет localStorage:lastResult) — снимок грузится сам из БД.
    const ctx = await page.context().browser()!.newContext({ baseURL });
    const p2 = await ctx.newPage();
    await p2.goto(`/signals?result=${id}`);
    await expect(p2.getByTestId('heat-cell').first()).toBeVisible({ timeout: 30000 });
    await expect(p2.getByText('Сохранённый результат')).toBeVisible({ timeout: 15000 });
    await expect(p2.getByTestId('result-copy-link')).toBeVisible();
    await ctx.close();
  });

  test('пермалинк: открытие из списка отражает ?result=<id> в адресной строке', async ({ page }) => {
    await setup(page);
    await page.getByTestId('run-study').click();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 150000 });
    await page.getByTestId('save-result-btn').click();
    await page.getByTestId('save-name-input').fill('Из-списка-тест');
    await page.getByTestId('save-name-confirm').click();
    await expect(page.getByText('Результат сохранён')).toBeVisible({ timeout: 15000 });
    // Новый прогон убирает ?result из URL (снимок ещё не сохранён).
    await page.getByTestId('run-study').click();
    await expect(page).not.toHaveURL(/[?&]result=\d+/);
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 150000 });
    // Открытие сохранённого из списка слева → ?result возвращается, кнопка «🔗 Ссылка» видна.
    await page.getByTestId('saved-results').getByTestId('result-open').first().click();
    await expect(page).toHaveURL(/[?&]result=\d+/);
    await expect(page.getByTestId('result-copy-link')).toBeVisible();
  });

  test('setops после открытия по ссылке: тикеры группы берутся из снимка (_req), а не из живого конфига', async ({ page, baseURL }) => {
    await setup(page);
    await page.getByTestId('run-study').click();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 150000 });
    await page.getByTestId('save-result-btn').click();
    await page.getByTestId('save-name-input').fill('setops-перм');
    await page.getByTestId('save-name-confirm').click();
    await expect(page.getByText('Результат сохранён')).toBeVisible({ timeout: 15000 });
    const id = new URL(page.url()).searchParams.get('result');
    expect(id).toBeTruthy();

    // Чистый контекст: НЕТ выбранной вселенной/custom. Раньше setops падал «Не удалось определить
    // тикеры группы», т.к. resolveGroup брал тикеры из живого (пустого) конфига страницы.
    const ctx = await page.context().browser()!.newContext({ baseURL });
    const p2 = await ctx.newPage();
    await p2.goto(`/signals?result=${id}`);
    await expect(p2.getByTestId('heat-cell').first()).toBeVisible({ timeout: 30000 });
    await p2.getByTestId('heat-cell').nth(0).click();
    await p2.getByTestId('heat-cell').nth(2).click();
    const out = p2.locator('[data-testid="signals-output"]');
    await out.getByRole('tab', { name: /И \(пересеч/ }).click();
    // Тикеры взяты из вшитого в снимок конфига → расчёт идёт, ошибки определения тикеров нет.
    await expect(p2.getByText('Не удалось определить тикеры группы')).toHaveCount(0);
    await expect(out.getByText(/Ср\. изб\. дох\.|слишком мало наблюдений/).first()).toBeVisible({ timeout: 150000 });
    await ctx.close();
  });

  test('setops на СТАРОМ снимке (без _req): тикеры группы восстанавливаются по метке пресета', async ({ page, baseURL }) => {
    await page.goto('/signals');
    await page.getByRole('button', { name: 'Металлы', exact: true }).click();
    await page.getByRole('button', { name: 'Сырьё (commodities)', exact: true }).click();
    await page.getByTestId('run-study').click();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 150000 });
    await page.getByTestId('save-result-btn').click();
    await page.getByTestId('save-name-input').fill('старый-снимок');
    await page.getByTestId('save-name-confirm').click();
    await expect(page.getByText('Результат сохранён')).toBeVisible({ timeout: 15000 });
    const id = new URL(page.url()).searchParams.get('result');
    expect(id).toBeTruthy();

    // Чистый контекст + ИМИТАЦИЯ старого снимка: вырезаем _req из ответа (как у результатов до фикса),
    // чтобы проверить именно фолбэк «метка группы → тикеры пресета».
    const ctx = await page.context().browser()!.newContext({ baseURL });
    const p2 = await ctx.newPage();
    await p2.route('**/api/signals/results/*', async (route) => {
      const resp = await route.fetch();
      const json = await resp.json();
      if (json?.result?.payload?._req) delete json.result.payload._req;
      await route.fulfill({ response: resp, json });
    });
    await p2.goto(`/signals?result=${id}`);
    await expect(p2.getByTestId('heat-cell').first()).toBeVisible({ timeout: 30000 });
    // Две ячейки ПЕРВОЙ группы (Металлы) → пересечение внутри одной таблицы.
    await p2.getByTestId('heat-cell').nth(0).click();
    await p2.getByTestId('heat-cell').nth(2).click();
    const out = p2.locator('[data-testid="signals-output"]');
    await out.getByRole('tab', { name: /И \(пересеч/ }).click();
    // Тикеры «Металлы» восстановлены по метке из пресета → расчёт идёт, ошибки определения тикеров нет.
    await expect(p2.getByText('Не удалось определить тикеры группы')).toHaveCount(0);
    await expect(out.getByText(/Ср\. изб\. дох\.|слишком мало наблюдений/).first()).toBeVisible({ timeout: 150000 });
    await ctx.close();
  });

  test('иностранные тикеры (7203.T) принимаются и строят карту', async ({ page }) => {
    await page.goto('/signals');
    await page.getByPlaceholder('SMH, GLD, TLT').fill('7203.T, 6758.T, PKN.WA, AAA, BBB');
    await page.getByTestId('run-study').click();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 150000 });
    await expect(page.locator('[data-testid="signals-output"]').getByText(/Свои тикеры/).first()).toBeVisible();
  });

  test('фактор «превышение ÷ волатильность» (xvol) строит карту', async ({ page }) => {
    await setup(page);
    await page.getByTestId('factor-select').selectOption('xvol');
    await page.getByTestId('run-study').click();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 150000 });
    await expect(page.locator('[data-testid="signals-output"]').getByText(/волатильность/i).first()).toBeVisible();
  });

  test('режим Фактор: перцентили (топ/дно %) строят хвосты лучшие/худшие', async ({ page }) => {
    await page.goto('/signals');
    await page.getByPlaceholder('SMH, GLD, TLT').fill('AAA, BBB, CCC, DDD, EEE, FFF, GGG, HHH, III, JJJ, KKK, LLL');
    await page.getByRole('button', { name: 'Топ/дно %' }).click();
    await page.locator('#thr').fill('5, 25');
    await page.getByTestId('run-study').click();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 150000 });
    const out = page.locator('[data-testid="signals-output"]');
    await expect(out.getByText('Худшие 5%', { exact: true })).toBeVisible();
    await expect(out.getByText('Лучшие 5%', { exact: true })).toBeVisible();
    // Клик по ячейке хвоста — детали есть, кнопки «сохранить как сигнал» нет (это не пороговый сигнал).
    await page.getByTestId('heat-cell').first().click();
    await expect(out.getByText(/худшие .*% по фактору|лучшие .*% по фактору/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить как сигнал' })).toHaveCount(0);
  });

  test('режим Фактор: диапазоны (от–до) строят непересекающиеся корзины', async ({ page }) => {
    await setup(page);
    await page.getByRole('button', { name: 'Диапазоны (от–до)' }).click();
    await page.getByTestId('run-study').click();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 150000 });
    await expect(page.locator('[data-testid="signals-output"]').getByText(/диапазон/i).first()).toBeVisible();
  });

  test('операции над выбранными ячейками: ИЛИ → И (пересечение по членству)', async ({ page }) => {
    await setup(page);
    await page.getByTestId('run-study').click();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 150000 });
    const out = page.locator('[data-testid="signals-output"]');
    // Выбираем 2 ячейки одной таблицы → появляется переключатель операции, по умолчанию ИЛИ (совокупно).
    await page.getByTestId('heat-cell').nth(0).click();
    await page.getByTestId('heat-cell').nth(2).click();
    await expect(out.getByRole('tab', { name: /И \(пересеч/ })).toBeVisible();
    await expect(out.getByText(/Совокупно/).first()).toBeVisible();
    // Переключаемся на «И» — серверный расчёт по реальному членству (Pyodide на синтетике).
    await out.getByRole('tab', { name: /И \(пересеч/ }).click();
    await expect(out.getByText(/И \(пересечение\)/).first()).toBeVisible({ timeout: 150000 });
    await expect(out.getByText(/Ср\. изб\. дох\.|мало наблюдений/).first()).toBeVisible({ timeout: 150000 });
  });

  test('операции над ячейками: «Либо/либо» (XOR — объединение без пересечения)', async ({ page }) => {
    await setup(page);
    await page.getByTestId('run-study').click();
    await expect(page.getByTestId('heat-cell').first()).toBeVisible({ timeout: 150000 });
    const out = page.locator('[data-testid="signals-output"]');
    // Две ячейки ОДНОЙ таблицы → доступна новая операция «Либо/либо» (ровно в одной ячейке).
    await page.getByTestId('heat-cell').nth(0).click();
    await page.getByTestId('heat-cell').nth(2).click();
    await out.getByRole('tab', { name: /Либо/ }).click();
    // Серверный расчёт XOR по членству: заголовок + метрика (или явное «мало наблюдений»).
    await expect(out.getByText(/Либо одно, либо другое/).first()).toBeVisible({ timeout: 150000 });
    await expect(out.getByText(/Ср\. изб\. дох\.|мало наблюдений/).first()).toBeVisible({ timeout: 150000 });
  });

  test('режим SMA/EMA: матрица доходности след. дня выше/ниже скользящих средних', async ({ page }) => {
    await setup(page);
    await page.getByTestId('tab-ma').click();
    await page.getByTestId('run-study').click();
    const out = page.locator('[data-testid="signals-output"]');
    // Появляется свод: либо матрицы SMA/EMA, либо сообщение о нехватке истории.
    await expect(out.getByText(/SMA — простая|Недостаточно истории/)).toBeVisible({ timeout: 150000 });
    if (await out.getByText(/SMA — простая/).count()) {
      // Две таблицы (SMA и EMA), колонки «Выше/Ниже/Разница», строки по окнам 10..200.
      await expect(out.getByTestId('ma-table')).toHaveCount(2);
      await expect(out.getByText('EMA — экспоненциальная')).toBeVisible();
      await expect(out.getByRole('columnheader', { name: 'Разница' }).first()).toBeVisible();
      // Строки окон присутствуют (10, 20, 50, 100, 200).
      await expect(out.getByTestId('ma-table').first().getByRole('cell', { name: '200', exact: true })).toBeVisible();
    }
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
