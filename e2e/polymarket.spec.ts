import { test, expect, type Page } from '@playwright/test';

// Смоук страницы Polymarket: секция «Сдвиги закономерностей» (с выбором окна),
// категории и русский перевод. Сеть Polymarket в e2e недоступна — мок API-роута.

const DAY = 86400;
const T0 = 1_700_000_000;
const move = (over: Partial<any> = {}) => ({
  d6h: 0, d24h: 0, d3d: 0, d7d: 0, d30d: 0,
  breakScore: 0.4, accel: 0, reversal: false, volSpike: false,
  direction: 0, points: 700, spark: [0.4, 0.45, 0.5, 0.48, 0.55, 0.6],
  daily: [
    { t: T0 - 3 * DAY, p: 0.50 },
    { t: T0 - 2 * DAY, p: 0.55 },
    { t: T0 - 1 * DAY, p: 0.60 },
    { t: T0, p: 0.57 },
  ],
  ...over,
});

const PAYLOAD = {
  fetchedAt: new Date().toISOString(),
  totalScanned: 1000,
  hasHistory: true,
  translated: true,
  movers: [
    {
      id: '1', question: 'Fed rate hike in 2026?', ru: 'Повышение ставок ФРС в 2026 году?',
      slug: 'fed-hike', cat: 'macro', prob: 0.57, vol: 2_590_550, liq: 417_614, spread: 0.01,
      daysLeft: 191, move: move({ d24h: -0.03, d3d: -0.08, d7d: 0.22, reversal: true, direction: -1 }),
    },
    {
      id: '2', question: 'Will WTI oil reach $100 in June?', ru: 'Достигнет ли нефть WTI $100 в июне?',
      slug: 'wti-100', cat: 'commodity', prob: 0.01, vol: 218_702, liq: 23_861, spread: 0.01,
      daysLeft: 8, move: move({ d24h: -0.012, d3d: -0.025, d7d: -0.04, volSpike: true, direction: -1 }),
    },
  ],
  categories: [
    {
      key: 'macro', label: 'Макро / ФРС', desc: 'Ставки, FOMC, рецессия.',
      markets: [
        { id: '1', question: 'Fed rate hike in 2026?', ru: 'Повышение ставок ФРС в 2026 году?', slug: 'fed-hike', cat: 'macro', prob: 0.57, vol: 2_590_550, liq: 417_614, spread: 0.01, daysLeft: 191, move: move({ d24h: -0.03 }) },
      ],
    },
    {
      key: 'megacap', label: 'Мегакапы — кто №1', desc: 'Largest company.',
      markets: [
        { id: '3', question: 'Will NVIDIA be the largest company?', ru: 'Будет ли NVIDIA крупнейшей компанией?', slug: 'nvda-largest', cat: 'megacap', prob: 0.97, vol: 3_575_886, liq: 124_805, spread: 0.001, daysLeft: 8, move: move({ d24h: -0.008 }) },
      ],
    },
  ],
  cached: false,
};

async function mock(page: Page) {
  await page.route('**/api/polymarket**', (r) => r.fulfill({ json: PAYLOAD }));
}

test('страница Polymarket: сдвиги, окно, категории, русский', async ({ page }) => {
  await mock(page);
  await page.goto('/polymarket');

  // заголовок и блок сдвигов
  await expect(page.getByRole('heading', { name: /Polymarket/ })).toBeVisible();
  await expect(page.getByText('🔥 Сдвиги закономерностей')).toBeVisible({ timeout: 15000 });

  // русский перевод виден
  await expect(page.getByText('Повышение ставок ФРС в 2026 году?').first()).toBeVisible();
  // флаг разворота
  await expect(page.getByText(/разворот/).first()).toBeVisible();

  // переключение окна на 7 дней не ломает страницу, мувер остаётся (d7d=+22пп)
  await page.getByRole('tab', { name: '7 дней' }).click();
  await expect(page.getByText('Повышение ставок ФРС в 2026 году?').first()).toBeVisible();

  // категории отрисованы
  await expect(page.getByText('Макро / ФРС')).toBeVisible();
  await expect(page.getByText('Мегакапы — кто №1')).toBeVisible();
  await expect(page.getByText('Будет ли NVIDIA крупнейшей компанией?').first()).toBeVisible();
});

test('полный текст и динамика по дням раскрываются', async ({ page }) => {
  await mock(page);
  await page.goto('/polymarket');
  await expect(page.getByText('🔥 Сдвиги закономерностей')).toBeVisible({ timeout: 15000 });

  // оригинальный текст (EN) показывается под переводом — текст не обрезан
  await expect(page.getByText('Fed rate hike in 2026?').first()).toBeVisible();

  // раскрытие «по дням» показывает дневную раскладку
  await page.getByRole('button', { name: /по дням/ }).first().click();
  await expect(page.getByText(/Динамика по дням/).first()).toBeVisible();
});

test('фильтр «только сдвинувшиеся» работает', async ({ page }) => {
  await mock(page);
  await page.goto('/polymarket');
  await expect(page.getByText('🔥 Сдвиги закономерностей')).toBeVisible({ timeout: 15000 });
  await page.getByRole('checkbox').check();
  // megacap-рынок (d24h=-0.8пп < 2пп) скрывается, macro (-3пп) остаётся
  await expect(page.getByText('Будет ли NVIDIA крупнейшей компанией?')).toHaveCount(0);
  await expect(page.getByText('Повышение ставок ФРС в 2026 году?').first()).toBeVisible();
});
