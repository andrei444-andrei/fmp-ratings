import { test, expect } from '@playwright/test';

// Раздел «Портфели» (/portfolios): объединение сетапов в стратегию. Сетап засеваем напрямую через API
// (поток сделок), затем на странице выбираем его, считаем метрики и кривую капитала. Без ключей —
// детерминированная синтетика (SPY), движок не падает. За собой убираем (delete сетапа/портфеля).

type Req = import('@playwright/test').APIRequestContext;

// Поток сделок на недавних датах (синтетический SPY покрывает ~13 лет до сегодня → любые входы найдутся).
function makeStream() {
  const rets = [3.2, -2.1, 5.0, 1.4, -1.2, 4.3, 2.0, -0.8];
  const today = Date.now();
  return rets.map((ret, i) => {
    const d = new Date(today - (300 - i * 32) * 864e5).toISOString().slice(0, 10);
    return [d, 'AAA', ret, ret - 0.5, Math.max(0, ret) + 1, Math.min(0, ret) - 1, Math.min(0, ret) - 2];
  });
}

async function seedSetup(request: Req, name: string) {
  const id = `e2e-pf-setup-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const res = await request.post('/api/researcher/setups', {
    data: {
      id,
      name,
      description: 'e2e сетап для портфелей',
      config: { uniText: 'AAA', horizon: 21, years: 10, view: 'all' },
      snapshot: { n: 8, avgExc: 0.8, avgRet: 1.3 },
      stream: makeStream(),
    },
  });
  expect(res.ok()).toBeTruthy();
  return id;
}

test.describe('Портфели /portfolios', () => {
  test('собрать портфель из сетапа: метрики и кривая капитала', async ({ page, request }) => {
    const name = `E2E-Сетап-PF-${Date.now()}`;
    const setupId = await seedSetup(request, name);

    await page.goto('/portfolios');
    await expect(page.getByRole('heading', { name: 'Портфели' })).toBeVisible();

    // сетап появился в списке выбора → выбираем
    const chip = page.getByTestId('setup-pick-chip').filter({ hasText: name });
    await expect(chip).toBeVisible({ timeout: 30000 });
    await chip.click();

    // считаем
    await page.getByTestId('portfolio-compute').click();

    // метрики и кривая капитала появились
    await expect(page.getByTestId('portfolio-metrics')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('portfolio-equity-svg')).toBeVisible({ timeout: 30000 });
    // метрика «Загрузка» содержит процент
    await expect(page.getByTestId('portfolio-metrics')).toContainText('Загрузка');
    await expect(page.getByTestId('portfolio-meta')).toContainText('сделок');

    // уборка
    await request.delete(`/api/researcher/setups?id=${encodeURIComponent(setupId)}`);
  });

  test('сохранение портфеля и персист в БД', async ({ page, request }) => {
    const name = `E2E-Сетап-PF2-${Date.now()}`;
    const setupId = await seedSetup(request, name);
    const pfName = `E2E-Портфель-${Date.now()}`;

    await page.goto('/portfolios');
    const chip = page.getByTestId('setup-pick-chip').filter({ hasText: name });
    await expect(chip).toBeVisible({ timeout: 30000 });
    await chip.click();

    await page.getByTestId('pf-name').fill(pfName);
    await page.getByTestId('portfolio-save').click();

    const pchip = page.getByTestId('portfolio-chip').filter({ hasText: pfName });
    await expect(pchip).toBeVisible({ timeout: 15000 });

    // персист: после перезагрузки портфель на месте, по клику считается
    await page.reload();
    const pchip2 = page.getByTestId('portfolio-chip').filter({ hasText: pfName });
    await expect(pchip2).toBeVisible({ timeout: 15000 });
    await pchip2.click();
    await expect(page.getByTestId('portfolio-metrics')).toBeVisible({ timeout: 30000 });

    // уборка: удаляем портфель (через UID-крестик) и сетап
    await pchip2.locator('[data-testid="portfolio-chip-del"]').click();
    await expect(page.getByTestId('portfolio-chip').filter({ hasText: pfName })).toHaveCount(0);
    await request.delete(`/api/researcher/setups?id=${encodeURIComponent(setupId)}`);
  });
});
