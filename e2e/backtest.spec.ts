import { test, expect } from '@playwright/test';

// Смоук «Тестирование стратегий» (/backtest): детерминированный событийный движок исполняется
// ПО-НАСТОЯЩЕМУ на синтетических ценах (без ключей FMP/AIMLAPI) на стратегии с UNIVERSE в коде.
// Проверяем отчёт (метрики/график/издержки/сделки) без карточек ошибок, автосохранение, а также
// сохранение/навигацию двух сущностей: СТРАТЕГИЙ и РЕЗУЛЬТАТОВ прогонов.

type Page = import('@playwright/test').Page;

// Маленькая стратегия (3 синтетических тикера) — чтобы прогон уложился в таймаут.
// Новая модель: тикеры задаются ПРЯМО В СКРИПТЕ переменной UNIVERSE.
async function fillSmallStrategy(page: Page) {
  await page.goto('/backtest');
  await page.getByTestId('strategy-code').fill(
    [
      'UNIVERSE = ["AAA", "BBB", "CCC"]',
      '',
      'def on_bar(ctx):',
      '    for s in ctx.symbols:',
      '        h = ctx.history(s, 20)',
      '        if len(h) < 20:',
      '            continue',
      '        if h[-1] > h[:-1].mean():',
      '            ctx.order_target_percent(s, 1.0 / len(ctx.symbols))',
      '        else:',
      '            ctx.order_target_percent(s, 0.0)',
    ].join('\n'),
  );
}

async function runSmallBacktest(page: Page) {
  await fillSmallStrategy(page);
  await page.getByTestId('run-backtest').click();
}

test.describe('Backtest /backtest', () => {
  test('страница и пустое состояние рендерятся', async ({ page }) => {
    await page.goto('/backtest');
    await expect(page.getByRole('heading', { name: 'Параметры теста' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Библиотека' })).toBeVisible();
    await expect(page.getByText('Здесь появится отчёт бэктеста')).toBeVisible();
    await expect(page.getByTestId('run-backtest')).toBeVisible();
    // Дефолтная стратегия предзаполнена, есть кнопка сохранения стратегии.
    await expect(page.getByTestId('strategy-code')).toContainText('def on_bar(ctx):');
    await expect(page.getByTestId('save-strategy')).toBeVisible();
    // AI-чат: поле сообщения + кнопка отправки.
    await expect(page.getByTestId('chat-input')).toBeVisible();
    await expect(page.getByTestId('chat-send')).toBeVisible();
  });

  test('прогоняет стратегию, рендерит отчёт без ошибок и автосохраняет', async ({ page }) => {
    await runSmallBacktest(page);
    // Кривая капитала (итеративный SVG) появляется по ходу прогона, метрики — после.
    await expect(page.getByTestId('equity-chart').locator('svg')).toBeVisible({ timeout: 180000 });
    await expect(page.locator('.research-output .rkit-kpi').first()).toBeVisible({ timeout: 180000 });
    // Таблица модели издержек по рынкам и лог сделок.
    await expect(page.locator('.research-output .rt-cap', { hasText: 'Модель издержек по рынкам' })).toBeVisible({ timeout: 60000 });
    await expect(page.locator('.research-output .rt-cap', { hasText: 'Сделки' })).toBeVisible({ timeout: 60000 });
    // Ни одной карточки ошибки.
    await expect(page.locator('.research-output .rerrblk')).toHaveCount(0);
    // Регресс: no-trade band отсекает «пустые» микро-сделки — в колонке «Кол-во» нет нулевых строк.
    const tradesBlock = page.locator('.research-output .rkit-tableblock', {
      has: page.locator('.rt-cap', { hasText: 'Сделки' }),
    });
    await expect(tradesBlock).toBeVisible({ timeout: 60000 });
    await expect(tradesBlock.locator('tbody tr td:nth-child(4)').filter({ hasText: /^0\.00$/ })).toHaveCount(0);
    // Автосохранение: прогон без активной стратегии авто-создаёт стратегию и кладёт прогон ВНУТРЬ неё.
    await expect(
      page.getByTestId('saved-strategies').locator('[data-testid="strategy-runs"]').first()
        .locator('[data-testid="run-open"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test('ручное сохранение результата вкладывается в стратегию', async ({ page }) => {
    await runSmallBacktest(page);
    await expect(page.locator('.research-output .rkit-kpi').first()).toBeVisible({ timeout: 180000 });
    // После прогона стратегия уже авто-создана и активна — ручной результат вложится в неё.
    await expect(page.getByTestId('update-strategy')).toBeVisible({ timeout: 30000 });

    await page.getByTestId('save-result').click();
    const title = 'e2e результат ' + Date.now();
    await page.getByPlaceholder('Название прогона').fill(title);
    await page.getByTestId('result-save-confirm').click();
    await expect(page.getByText('Результат сохранён')).toBeVisible({ timeout: 15000 });

    // Результат виден среди прогонов стратегии; открывается и удаляется.
    const item = page.getByTestId('strategy-runs').locator('[data-testid="run-open"]').filter({ hasText: title }).first();
    await expect(item).toBeVisible({ timeout: 15000 });
    await item.click();
    await expect(page.getByText('Сохранённый результат')).toBeVisible();
    await expect(page.locator('.research-output .rkit-kpi').first()).toBeVisible();

    const li = page.locator('[data-testid="strategy-runs"] li').filter({ hasText: title }).first();
    await li.getByRole('button', { name: 'Удалить прогон' }).click();
    await expect(page.getByText('Результат удалён')).toBeVisible({ timeout: 15000 });
  });

  test('сохранение → открытие → удаление СТРАТЕГИИ', async ({ page }) => {
    await fillSmallStrategy(page);

    await page.getByTestId('save-strategy').click();
    const title = 'e2e стратегия ' + Date.now();
    await page.getByTestId('strategy-title').fill(title);
    await page.getByTestId('strategy-save-confirm').click();
    await expect(page.getByText('Стратегия сохранена')).toBeVisible({ timeout: 15000 });
    // Стала активной (индикатор + кнопка обновления).
    await expect(page.getByTestId('update-strategy')).toBeVisible();

    // Появилась в библиотеке стратегий, открывается в редактор.
    const item = page.getByTestId('saved-strategies').locator('[data-testid="strategy-open"]').filter({ hasText: title });
    await expect(item).toBeVisible();
    await page.getByTestId('new-strategy').click(); // сбросить редактор
    await item.click();
    await expect(page.getByText('Стратегия открыта')).toBeVisible();
    await expect(page.getByTestId('strategy-code')).toContainText('UNIVERSE = ["AAA", "BBB", "CCC"]');

    // Удаление стратегии.
    const li = page.getByTestId('saved-strategies').locator('li').filter({ hasText: title }).first();
    await li.getByRole('button', { name: 'Удалить стратегию' }).first().click();
    await expect(page.getByText('Стратегия удалена')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('saved-strategies').locator('[data-testid="strategy-open"]').filter({ hasText: title })).toHaveCount(0);
  });

  test('AI-чат: сообщение появляется в логе, очистка работает', async ({ page }) => {
    await page.goto('/backtest');
    // Лога ещё нет, пока не отправлено сообщение.
    await expect(page.getByTestId('chat-log')).toHaveCount(0);
    await page.getByTestId('chat-input').fill('сделай моментум на QQQ');
    await page.getByTestId('chat-send').click();
    // Сообщение пользователя сразу появляется в логе чата (оптимистично).
    await expect(page.getByTestId('chat-log')).toContainText('сделай моментум на QQQ');
    // В e2e нет ключа AIMLAPI → понятная ошибка (диалог при этом уже виден).
    await expect(page.getByText('AI-чат недоступен')).toBeVisible({ timeout: 15000 });
    // Очистка убирает историю чата.
    await page.getByTestId('chat-clear').click();
    await expect(page.getByTestId('chat-log')).toHaveCount(0);
  });

  test('чат привязан к стратегии: сохраняется и переживает переоткрытие', async ({ page }) => {
    const tag = 'ZQ' + Date.now().toString().slice(-7); // уникальный тикер → отличимая стратегия
    await page.goto('/backtest');
    await page.getByTestId('strategy-code').fill(
      [
        `UNIVERSE = ["AAA", "BBB", "${tag}"]`,
        '',
        'def on_bar(ctx):',
        '    for s in ctx.symbols:',
        '        ctx.order_target_percent(s, 1.0 / len(ctx.symbols))',
      ].join('\n'),
    );
    await page.getByTestId('run-backtest').click();
    // Прогон без активной стратегии авто-создаёт её → появляется кнопка «Обновить» (стратегия активна).
    await expect(page.getByTestId('update-strategy')).toBeVisible({ timeout: 60000 });

    // Пишем в чат: AI без ключа упадёт, но сообщение пользователя остаётся в треде и автосохраняется в стратегию.
    const msg = 'тестовая идея ' + tag;
    await page.getByTestId('chat-input').fill(msg);
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('chat-log')).toContainText(msg);
    await page.waitForTimeout(1500); // даём debounce-автосохранению чата уйти на сервер

    // Перезагружаем и переоткрываем ту же стратегию по уникальному тегу — единый тред восстановлен.
    await page.reload();
    const row = page.getByTestId('saved-strategies').locator('li').filter({ hasText: tag }).first();
    await row.getByTestId('strategy-open').click();
    await expect(page.getByTestId('chat-log')).toContainText(msg, { timeout: 15000 });
  });

  test('пермалинк прогона: ?run открывает результат по прямой ссылке', async ({ page }) => {
    await runSmallBacktest(page);
    // Вложенный прогон в авто-созданной стратегии.
    const runOpen = page
      .getByTestId('saved-strategies')
      .locator('[data-testid="strategy-runs"]')
      .first()
      .locator('[data-testid="run-open"]')
      .first();
    await expect(runOpen).toBeVisible({ timeout: 60000 });
    await runOpen.click();
    await expect(page.getByText('Сохранённый результат')).toBeVisible({ timeout: 15000 });

    // Открытие прогона отражается в адресной строке (ссылка, а не только навигация).
    await expect.poll(() => new URL(page.url()).searchParams.get('run')).not.toBeNull();
    const runParam = new URL(page.url()).searchParams.get('run');

    // По прямой ссылке результат подгружается сам, без кликов по библиотеке.
    await page.goto(`/backtest?run=${runParam}`);
    await expect(page.getByText('Сохранённый результат')).toBeVisible({ timeout: 30000 });
  });
});
