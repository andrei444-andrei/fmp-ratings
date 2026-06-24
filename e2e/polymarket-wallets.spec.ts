import { test, expect, type Page } from '@playwright/test';

// Смоук страницы «Умные деньги»: лидерборд, фильтр категории, разбивка по категориям,
// кнопка краула. Сеть Polymarket недоступна — мокаем API-роут.

const WALLETS = [
  {
    address: '0xaaaa000000000000000000000000000000000001',
    n: 40, meanEdge: 0.12, tStat: 3.4, pValue: 0.001, significant: true,
    winRate: 0.62, totalPnl: 15000, roi: 0.4, valueUsd: 80000, minHorizon: 30,
    aiSummary: null, samples: [{ question: 'Fed cut in March?', category: 'macro', win: 1, entry: 0.4, pnl: 600 }],
    byCat: { macro: { n: 25, meanEdge: 0.18, tStat: 3.1, significant: true, winRate: 0.68, totalPnl: 12000 },
             crypto: { n: 15, meanEdge: 0.02, tStat: 0.4, significant: false, winRate: 0.5, totalPnl: 3000 } },
  },
  {
    address: '0xbbbb000000000000000000000000000000000002',
    n: 30, meanEdge: -0.05, tStat: -1.2, pValue: 0.8, significant: false,
    winRate: 0.45, totalPnl: -5000, roi: -0.2, valueUsd: 12000, minHorizon: 30,
    aiSummary: null, samples: [],
    byCat: { equity: { n: 30, meanEdge: -0.05, tStat: -1.2, significant: false, winRate: 0.45, totalPnl: -5000 } },
  },
];

async function mock(page: Page) {
  await page.route('**/api/polymarket/wallets**', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ json: { discovered: 100, scored: 20, smartFound: 1, progress: { candidates: 100, scored: 20, smart: 1 } } });
    }
    const url = new URL(route.request().url());
    const cat = url.searchParams.get('category') || 'all';
    let ws = WALLETS;
    if (cat !== 'all') ws = WALLETS.filter((w) => (w as any).byCat[cat]);
    return route.fulfill({ json: { wallets: ws, progress: { candidates: 100, scored: 20, smart: 1 } } });
  });
}

test('лидерборд умных денег: значимость, разбивка, фильтр категории', async ({ page }) => {
  await mock(page);
  await page.goto('/polymarket/wallets');

  await expect(page.getByRole('heading', { name: /Умные деньги/ })).toBeVisible();
  await expect(page.getByText('0xaaaa…0001')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('значим p<0.05').first()).toBeVisible();

  // разбивка по категориям раскрывается. dispatchEvent — минуем липкий навбар,
  // который на коротком мобильном вьюпорте перекрывает верх (известная проблема репо).
  await page.getByRole('button', { name: /по категориям/ }).first().dispatchEvent('click');
  await expect(page.getByText(/Edge по типам событий/).first()).toBeVisible();

  // фильтр по категории crypto оставляет только кошелёк с crypto-историей
  await page.getByRole('tab', { name: 'Крипто' }).dispatchEvent('click');
  await expect(page.getByText('0xaaaa…0001')).toBeVisible();
  await expect(page.getByText('0xbbbb…0002')).toHaveCount(0);
});

test('кнопка краула вызывает POST и обновляет', async ({ page }) => {
  await mock(page);
  await page.goto('/polymarket/wallets');
  await expect(page.getByText('0xaaaa…0001')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /Найти \+ оценить/ }).click();
  await expect(page.getByText(/Значимых найдено/)).toBeVisible();
});
