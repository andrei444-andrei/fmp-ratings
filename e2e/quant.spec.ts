import { test, expect, type Page } from '@playwright/test';

// Смоук раздела «Аналитика алгоритмов» (QuantConnect). Живой путь к QuantConnect в e2e
// недоступен — graceful-состояния + UI-флоу на мок-данных (управление портфелем, матрица v2).

const ALGOS = [
  { id: 1, projectId: '111', backtestId: 'abc', name: 'EMA Cross', benchmark: null, description: 'плечо 2x, контроль просадки', status: 'active', sortOrder: 0, createdAt: '' },
  { id: 2, projectId: '222', backtestId: null, name: 'Mean Reversion', benchmark: null, description: null, status: 'research', sortOrder: 1, createdAt: '' },
];

const PORTFOLIO = {
  years: [2022, 2023],
  algos: [
    {
      id: 1, name: 'EMA Cross', projectId: '111', backtestId: 'abc', resolvedBacktestId: 'abc',
      status: 'active', description: 'плечо 2x, контроль просадки', error: null,
      years: {
        2022: { year: 2022, ret: 0.30, maxDD: -0.10, cumulative: 0.30 },  // > БМ 0.10 → ▲
        2023: { year: 2023, ret: 0.05, maxDD: -0.12, cumulative: 0.365 }, // < БМ 0.20 → ▼
      },
      totalReturn: 0.365, pointCount: 500,
    },
    {
      id: 2, name: 'Mean Reversion', projectId: '222', backtestId: null, resolvedBacktestId: 'def',
      status: 'research', description: null, error: null,
      years: {
        2022: { year: 2022, ret: 0.12, maxDD: -0.08, cumulative: 0.12 },
        2023: { year: 2023, ret: 0.22, maxDD: -0.06, cumulative: 0.366 },
      },
      totalReturn: 0.366, pointCount: 500,
    },
  ],
  benchmark: {
    name: 'SPY',
    years: { 2022: { year: 2022, ret: 0.10, maxDD: -0.20, cumulative: 0.10 }, 2023: { year: 2023, ret: 0.20, maxDD: -0.10, cumulative: 0.32 } },
    totalReturn: 0.32,
  },
};

// синтетический дневной ряд капитала (шаг 3 дня) с детерминированной волатильностью
function daily(start: number, growth: number, n: number, amp = 0.012, phase = 0, startYear = 2022) {
  const pts: { d: string; v: number }[] = [];
  let v = start;
  const base = Date.UTC(startYear, 0, 3);
  for (let i = 0; i < n; i++) {
    const dt = new Date(base + i * 3 * 86400000);
    const d = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    pts.push({ d, v: Math.round(v) });
    v *= 1 + growth + amp * Math.sin(i * 0.5 + phase);
    if (v < start * 0.3) v = start * 0.3;
  }
  return pts;
}
const SERIES = {
  algos: [
    { id: 1, name: 'EMA Cross', status: 'active', error: null, daily: daily(100000, 0.004, 240, 0.02, 0) },
    { id: 2, name: 'Mean Reversion RSI', status: 'research', error: null, daily: daily(100000, 0.002, 240, 0.015, 1.5) },
  ],
  benchmark: { name: 'SPY', daily: daily(100000, 0.003, 240, 0.03, 3.0) },
};

// сделки на каждый месяц 2022–2023 (чтобы любой кликнутый месяц имел сделки)
function genTrades() {
  const t: any[] = [];
  for (let y = 2022; y <= 2023; y++) for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    t.push({ time: `${y}-${mm}-08T14:30:00Z`, symbol: 'SPY', direction: 'buy', quantity: 12, price: 410.25, value: 4923, type: 'Market', status: 'Filled' });
    t.push({ time: `${y}-${mm}-20T15:00:00Z`, symbol: 'AAPL', direction: 'sell', quantity: 30, price: 175.4, value: 5262, type: 'Limit', status: 'Filled' });
  }
  return t;
}
const TRADES = genTrades();

async function mockConfigured(page: Page) {
  await page.route('**/api/quantconnect/credentials**', r => r.fulfill({ json: { configured: true, userId: '123', tokenHint: '••••cafe' } }));
  await page.route('**/api/quantconnect/algorithms**', async route => {
    const m = route.request().method();
    if (m === 'DELETE') return route.fulfill({ json: { algorithms: [ALGOS[1]] } });
    if (m === 'PATCH' || m === 'POST') return route.fulfill({ json: { algorithm: ALGOS[0], algorithms: ALGOS } });
    return route.fulfill({ json: { algorithms: ALGOS } }); // GET
  });
  await page.route('**/api/quantconnect/portfolio**', r => r.fulfill({ json: PORTFOLIO }));
  await page.route('**/api/quantconnect/series**', r => r.fulfill({ json: SERIES }));
  await page.route('**/api/quantconnect/trades**', r => r.fulfill({ json: { id: 1, name: 'EMA Cross', trades: TRADES, capped: false, total: TRADES.length, error: null } }));
  await page.route('**/api/quantconnect/allocation**', r => r.fulfill({ json: {
    id: 1, name: 'EMA Cross', approx: false, capped: false, error: null,
    symbols: ['SPY', 'AAPL'],
    years: [
      { year: 2022, weights: { SPY: 0.6, AAPL: 0.3 }, cash: 0.1, months: 12 },
      { year: 2023, weights: { SPY: 0.5, AAPL: 0.4 }, cash: 0.1, months: 12 },
    ],
  } }));
  await page.route('**/api/quantconnect/backtests**', r => r.fulfill({ json: { backtests: [
    { backtestId: 'aaa111', name: 'run A', status: 'Completed.', completed: true },
    { backtestId: 'bbb222', name: 'run B', status: 'Completed.', completed: true },
  ] } }));
  await page.route('**/api/quantconnect/describe**', r => r.fulfill({ json: { description: '## Стратегия\n\nГенерированное **описание**.' } }));
  await page.route('**/api/quantconnect/chat**', r => r.fulfill({ json: { reply: 'Лучшая — **leverage with control DD**: выше CAGR и больше лет лучше SPY.' } }));
  await page.route('**/api/quantconnect/settings**', async route => {
    if (route.request().method() === 'PUT') return route.fulfill({ json: { ok: true } });
    return route.fulfill({ json: { key: 'combined', value: null } });
  });
}

test.describe('Аналитика алгоритмов /quant', () => {
  test('без кредов: уведомление и заблокированная кнопка добавления', async ({ page }) => {
    await page.goto('/quant');
    await expect(page.locator('.qc-title')).toHaveText('Аналитика алгоритмов');
    await expect(page.getByText(/Креды QuantConnect не заданы/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.qc-panel-h').filter({ hasText: 'Портфель стратегий' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Добавить стратегию/ })).toBeDisabled();
  });

  test('навигация содержит ссылки на оба раздела', async ({ page }) => {
    await page.goto('/quant');
    await expect(page.getByRole('link', { name: 'Аналитика алгоритмов' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Исследование трендов' })).toBeVisible();
  });

  test('страница всегда светлая, даже при глобальной тёмной теме', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); } catch {} });
    await page.goto('/quant');
    await expect(page.locator('.qc-title')).toBeVisible();
    const probe = await page.evaluate(() => ({
      htmlTheme: document.documentElement.dataset.theme,
      navBg: getComputedStyle(document.querySelector('.app-nav')!).backgroundColor,
    }));
    expect(probe.htmlTheme).toBe('dark');
    expect(probe.navBg).toBe('rgba(255, 255, 255, 0.82)');
  });

  test('вкладки use-кейсов: все активны', async ({ page }) => {
    await page.goto('/quant');
    for (const name of ['Сводка по стратегии', 'Объединённый портфель', 'Риск / корреляция']) {
      await expect(page.getByRole('button', { name })).toBeEnabled();
    }
  });

  test('анализ просадок: underwater и таблица эпизодов (в сводке)', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    await page.getByRole('button', { name: 'Сводка по стратегии' }).click();
    const uwPanel = page.locator('.qc-panel', { hasText: 'Просадки (underwater' });
    await expect(uwPanel.locator('.qc-panel-h')).toBeVisible();
    // underwater сравнивается с SPY — есть легенда SPY
    await expect(uwPanel.locator('.qc-legend', { hasText: 'SPY' })).toBeVisible();
    await expect(page.locator('.qc-matrix').getByText('Глубина')).toBeVisible();
    await expect(page.locator('.qc-matrix').getByText('Восстановление')).toBeVisible();
  });

  test('сводка по стратегии: метрики, кривая, помесячный heatmap, Δ к SPY', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    await page.getByRole('button', { name: 'Сводка по стратегии' }).click();
    await expect(page.locator('.qc-card-k', { hasText: 'Sharpe' })).toBeVisible();
    await expect(page.locator('.qc-card-k', { hasText: 'Calmar' })).toBeVisible();
    await expect(page.locator('svg.qc-chart').first()).toBeVisible();
    await expect(page.locator('.qc-heat').first()).toBeVisible();
    // таблица помесячного превышения/занижения к SPY
    await expect(page.locator('.qc-panel-h').filter({ hasText: 'Δ к SPY' })).toBeVisible();
    const stratSel = page.locator('.qc-controls-bar', { hasText: 'Стратегия' }).locator('select.qc-select');
    await stratSel.selectOption({ label: 'Mean Reversion RSI' });
    await expect(page.locator('.qc-heat').first()).toBeVisible();
  });

  test('сводка: клик по месяцу показывает сделки справа', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    await page.getByRole('button', { name: 'Сводка по стратегии' }).click();
    // до выбора месяца — подсказка
    await expect(page.locator('.qc-trades-empty').first()).toBeVisible();
    // кликаем первую кликабельную ячейку месяца (таблица «Помесячная доходность»)
    await page.locator('.qc-heat td.clk').first().click();
    // появляется панель сделок с таблицей buy/sell
    await expect(page.locator('.qc-trades-h').first()).toContainText('Сделки');
    await expect(page.locator('.qc-trades-list .qc-side.buy').first()).toBeVisible();
    await expect(page.locator('.qc-trades-list .qc-side.sell').first()).toBeVisible();
    await expect(page.locator('.qc-trades-list td.sym').first()).toContainText('SPY');
  });

  test('сводка: клик по ячейке Δ к SPY тоже показывает сделки', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    await page.getByRole('button', { name: 'Сводка по стратегии' }).click();
    // вторая таблица (Δ к SPY) — её ячейки тоже кликабельны
    const deltaPanel = page.locator('.qc-panel', { hasText: 'Δ к SPY' });
    await deltaPanel.locator('.qc-heat td.clk').first().click();
    await expect(deltaPanel.locator('.qc-trades-h')).toContainText('Сделки');
    await expect(deltaPanel.locator('.qc-trades-list td.sym').first()).toContainText('SPY');
  });

  test('сводка: состав активов по годам (по кнопке)', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    await page.getByRole('button', { name: 'Сводка по стратегии' }).click();
    const panel = page.locator('.qc-panel', { hasText: 'Состав активов по годам' });
    await panel.getByRole('button', { name: 'Показать состав активов' }).click();
    // появляется таблица с инструментами, годами и колонкой «Кэш»
    await expect(panel.locator('.qc-heat th', { hasText: 'SPY' })).toBeVisible();
    await expect(panel.locator('.qc-heat th', { hasText: 'Кэш' })).toBeVisible();
    await expect(panel.locator('.qc-heat td.lbl', { hasText: '2023' })).toBeVisible();
    await expect(panel.locator('.qc-alloc-note')).toContainText('Оценка');
  });

  test('риск / корреляция: матрица, метрики, downside', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    await page.getByRole('button', { name: 'Риск / корреляция' }).click();
    await expect(page.locator('.qc-corr').first()).toBeVisible();
    await expect(page.locator('.qc-card-k', { hasText: 'ENB' })).toBeVisible();
    await expect(page.locator('.qc-card-k', { hasText: 'Ср. корреляция' })).toBeVisible();
    await expect(page.locator('.qc-card-k', { hasText: 'Diversification ratio' })).toBeVisible();
    // переключение разрешения пересчитывает матрицу
    await page.getByRole('button', { name: 'Неделя' }).click();
    await expect(page.locator('.qc-corr').first()).toBeVisible();
  });

  test('объединённый портфель: веса, карточки, график, годовая таблица', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    await page.getByRole('button', { name: 'Объединённый портфель' }).click();

    await expect(page.locator('.qc-panel-h').filter({ hasText: 'Состав портфеля' })).toBeVisible();
    // стат-карточки
    await expect(page.locator('.qc-card-k', { hasText: 'CAGR' }).first()).toBeVisible();
    await expect(page.locator('.qc-card-k', { hasText: 'Макс. просадка' })).toBeVisible();
    // график капитала + underwater портфеля vs бенчмарк
    await expect(page.locator('svg.qc-chart').first()).toBeVisible();
    await expect(page.locator('.qc-panel-h').filter({ hasText: 'Просадки (underwater)' })).toBeVisible();
    // годовая таблица + колонка Δ к SPY
    await expect(page.locator('.qc-matrix').getByText('Портфель', { exact: true })).toBeVisible();
    await expect(page.locator('.qc-matrix').getByText('Δ к SPY')).toBeVisible();
    // равные веса
    await page.getByRole('button', { name: 'Равные веса' }).click();
  });

  test('объединённый портфель: сохранённые веса подгружаются', async ({ page }) => {
    await mockConfigured(page);
    await page.route('**/api/quantconnect/settings**', async route => {
      if (route.request().method() === 'PUT') return route.fulfill({ json: { ok: true } });
      return route.fulfill({ json: { key: 'combined', value: { include: { '1': true, '2': false }, weights: { '1': 3, '2': 2 } } } });
    });
    await page.goto('/quant');
    await page.getByRole('button', { name: 'Объединённый портфель' }).click();
    const row = page.locator('.qc-wrow', { hasText: 'EMA Cross' });
    await expect(row.locator('input.qc-winput')).toHaveValue('3'); // вес из сохранённого конфига
  });

  test('кнопка добавления открывает модалку с режимами поиск/вручную', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    await page.getByRole('button', { name: /Добавить стратегию/ }).click();
    await expect(page.locator('.qc-modal-h').filter({ hasText: 'Добавить стратегию' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Вручную' })).toBeVisible();
    await page.getByRole('button', { name: 'Вручную' }).click();
    await expect(page.getByText('Project ID')).toBeVisible();
    await expect(page.getByPlaceholder('123456')).toBeVisible();
    // статус и описание в форме
    await expect(page.getByText('Описание (опц.)')).toBeVisible();
  });

  test('менеджер портфеля: бейджи статусов, описание, матрица v2', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');

    // строки стратегий со статус-бейджами и описанием
    const strat = page.locator('.qc-strat', { hasText: 'EMA Cross' });
    await expect(strat).toBeVisible();
    await expect(strat.locator('.qc-badge.active')).toHaveText('Активно');
    await expect(strat.locator('.qc-spoiler > summary')).toHaveText('описание'); // описание под спойлером
    await expect(strat).toContainText('плечо 2x');
    await expect(page.locator('.qc-strat', { hasText: 'Mean Reversion' }).locator('.qc-badge.research')).toHaveText('Исследование');

    // матрица: бенчмарк = SPY + заливка ячейки доходности vs бенчмарк
    const matrix = page.locator('.qc-matrix').first();
    await expect(matrix).toBeVisible();
    await expect(matrix.locator('th.bench')).toHaveText('SPY');
    await expect(matrix.locator('td.qc-beat').first()).toBeVisible(); // обыграл БМ
    await expect(matrix.locator('td.qc-lag').first()).toBeVisible();  // проиграл БМ

    // стат-блок (включая CAGR)
    await expect(matrix.getByText('Ср. / год')).toBeVisible();
    await expect(matrix.getByText('CAGR', { exact: true })).toBeVisible();
    await expect(matrix.getByText('σ (разброс)')).toBeVisible();
    await expect(matrix.getByText('Лучший / худший')).toBeVisible();
    await expect(matrix.getByText('Лет лучше БМ')).toBeVisible();
    await expect(matrix.getByText('Итог', { exact: true })).toBeVisible();
  });

  test('выбор стартового года сужает окно анализа', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    const matrix = page.locator('.qc-matrix').first();
    await expect(matrix.getByText('2022', { exact: true })).toBeVisible();
    await page.locator('.qc-controls-bar', { hasText: 'С года' }).locator('select.qc-select').selectOption('2023');
    await expect(matrix.getByText('2022', { exact: true })).toHaveCount(0);
    await expect(matrix.getByText('2023', { exact: true })).toBeVisible();
  });

  test('удаление стратегии требует подтверждения', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    const strat = page.locator('.qc-strat', { hasText: 'EMA Cross' });
    await strat.getByTitle('Удалить').click();
    await expect(page.getByText(/Действие/)).toBeVisible();
    await expect(page.getByText(/необратимо/)).toBeVisible();
    await page.locator('.qc-modal-foot').getByRole('button', { name: 'Удалить' }).click();
    await expect(page.getByText(/необратимо/)).toHaveCount(0); // модалка закрылась
  });

  test('AI-чат: всплывает и отвечает по данным портфеля (мок)', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    await expect(page.locator('.qc-chat-fab')).toBeVisible();
    await page.locator('.qc-chat-fab').click();
    await expect(page.locator('.qc-chat')).toBeVisible();
    await page.locator('.qc-chat-input textarea').fill('какая стратегия лучшая?');
    await page.locator('.qc-chat-input').getByRole('button').click();
    await expect(page.locator('.qc-msg.user')).toContainText('какая стратегия лучшая');
    await expect(page.locator('.qc-msg.assistant .qc-md')).toContainText('leverage with control DD');
  });

  test('AI-чат: веб-поиск показывает источники', async ({ page }) => {
    await mockConfigured(page);
    await page.route('**/api/quantconnect/chat**', r => r.fulfill({ json: {
      reply: 'В октябре 2015 в Японии **Банк Японии** сохранил ставку.',
      web: true,
      citations: ['https://www.reuters.com/article/boj', 'https://www.bloomberg.com/news/japan'],
    } }));
    await page.goto('/quant');
    await page.locator('.qc-chat-fab').click();
    await page.locator('.qc-chat-input textarea').fill('что было в Японии в октябре 2015?');
    await page.locator('.qc-chat-input').getByRole('button').click();
    await expect(page.locator('.qc-msg-web')).toContainText('поиск в интернете');
    await expect(page.locator('.qc-cites a').first()).toContainText('reuters.com');
    await expect(page.locator('.qc-cites a')).toHaveCount(2);
  });

  test('редактирование: статус, markdown-редактор, генерация из кода', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    const strat = page.locator('.qc-strat', { hasText: 'EMA Cross' });
    await strat.getByTitle('Редактировать').click();
    const modal = page.locator('.qc-modal');
    await expect(modal.locator('.qc-modal-h').filter({ hasText: 'Редактировать стратегию' })).toBeVisible();
    // панель стилей редактора
    await expect(modal.locator('.qc-mde-bar')).toBeVisible();
    await expect(modal.getByTitle('Жирный')).toBeVisible();
    // генерация описания из кода QC
    await modal.getByRole('button', { name: /Сгенерировать из кода/ }).click();
    await expect(modal.locator('textarea.qc-mde-ta')).toHaveValue(/Генерированное/);
    // превью рендерит markdown
    await modal.getByRole('button', { name: 'Превью', exact: true }).click();
    await expect(modal.locator('.qc-mde-preview .qc-md')).toContainText('Стратегия');
    // можно сменить бектест (источник)
    await modal.locator('select.qc-select').nth(1).selectOption('bbb222');
    // статус (первый select) + сохранить
    await modal.locator('select.qc-select').first().selectOption('archive');
    await page.locator('.qc-modal-foot').getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.locator('.qc-modal-h').filter({ hasText: 'Редактировать стратегию' })).toHaveCount(0);
  });

  test('редактирование: выбор другого бектеста как источника', async ({ page }) => {
    await mockConfigured(page);
    await page.goto('/quant');
    await page.locator('.qc-strat', { hasText: 'EMA Cross' }).getByTitle('Редактировать').click();
    const modal = page.locator('.qc-modal');
    await expect(modal.getByText('Источник — проект и бектест')).toBeVisible();
    const btSelect = modal.locator('select.qc-select').nth(1);
    await expect(btSelect.locator('option', { hasText: 'run B' })).toHaveCount(1);
    await btSelect.selectOption('bbb222');
    await page.locator('.qc-modal-foot').getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.locator('.qc-modal-h').filter({ hasText: 'Редактировать стратегию' })).toHaveCount(0);
  });
});

test.describe('Админка кредов QuantConnect /admin/quantconnect', () => {
  test('форма кредов рендерится со статусом «не заданы»', async ({ page }) => {
    await page.goto('/admin/quantconnect');
    await expect(page.getByRole('heading', { name: 'QuantConnect — доступ' })).toBeVisible();
    await expect(page.getByText(/Статус:/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('не заданы')).toBeVisible();
    await expect(page.getByPlaceholder('напр. 123456')).toBeVisible();
  });
});
