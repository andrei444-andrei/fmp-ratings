import { test, expect } from '@playwright/test';

// Раздел «Портфели» (/portfolios): пошаговый мастер теста стратегии из сетапов.
// Сетап засеваем через API (поток сигналов), затем проходим мастер: новый тест → вселенная →
// ребалансировка → параметры → запуск; проверяем метрики, кривую капитала и авто-сохранение.
// Без ключей — синтетика (SPY/цены), движок и AI-нейминг деградируют мягко (запасное имя).

type Req = import('@playwright/test').APIRequestContext;

function makeStream() {
  const rets = [3.2, -2.1, 5.0, 1.4, -1.2, 4.3, 2.0, -0.8];
  const today = Date.now();
  return rets.map((ret, i) => {
    const d = new Date(today - (300 - i * 32) * 864e5).toISOString().slice(0, 10);
    const sym = i % 2 ? 'BBB' : 'AAA';
    return [d, sym, ret, ret - 0.5, Math.max(0, ret) + 1, Math.min(0, ret) - 1, Math.min(0, ret) - 2];
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

async function runWizard(page: import('@playwright/test').Page, setupName: string) {
  await page.getByTestId('new-test').click();
  const chip = page.getByTestId('setup-pick-chip').filter({ hasText: setupName });
  await expect(chip).toBeVisible({ timeout: 30000 });
  await chip.click();
  await page.getByTestId('wizard-next').click(); // → Ребалансировка
  await page.getByTestId('wizard-next').click(); // → Параметры
  await page.getByTestId('wizard-next').click(); // → Запуск
  await page.getByTestId('wizard-run').click();
}

test.describe('Портфели /portfolios', () => {
  test('мастер: новый тест → запуск → метрики, кривая, авто-имя', async ({ page, request }) => {
    const name = `E2E-Сетап-PF-${Date.now()}`;
    const setupId = await seedSetup(request, name);

    await page.goto('/portfolios');
    await expect(page.getByRole('heading', { name: 'Портфели' })).toBeVisible();
    await runWizard(page, name);

    await expect(page.getByTestId('portfolio-metrics')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('portfolio-equity-svg')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('portfolio-meta')).toContainText('сигналов');
    // автосохранение присвоило имя (запасное без ключа AIMLAPI)
    await expect(page.getByTestId('portfolio-name')).not.toHaveValue('');
    // метрика win-rate vs SPY + подписи лет по оси X
    await expect(page.getByTestId('portfolio-metrics')).toContainText('Win-rate vs SPY');
    await expect(page.getByTestId('pf-xaxis')).toBeVisible();

    // разбивка по периодам с бенчмарком + переключение грануляции
    await expect(page.getByTestId('pf-period-svg')).toBeVisible();
    await expect(page.getByTestId('pf-period-table')).toBeVisible();
    // тумблер «SPY на загрузке» добавляет колонку
    await page.getByTestId('pf-loaded-toggle').click();
    await expect(page.getByTestId('pf-period-table')).toContainText('SPY (загр)');
    await page.getByTestId('pf-gran').getByRole('button', { name: 'Месяц' }).click();
    await expect(page.getByTestId('pf-period-table')).toBeVisible();

    // drill-down недели: грануляция «Неделя» → клик по строке → состав/экспозиция/причины
    await page.getByTestId('pf-gran').getByRole('button', { name: 'Неделя' }).click();
    const wrow = page.getByTestId('pf-week-row').first();
    await expect(wrow).toBeVisible();
    await wrow.click();
    await expect(page.getByTestId('pf-week-meta')).toBeVisible();
    await expect(page.getByTestId('pf-week-positions')).toBeVisible();

    // сделки по ребалансам/входам: список + долевая полоса при выборе сделки
    await expect(page.getByTestId('pf-reb-table')).toBeVisible();
    const rrow = page.getByTestId('pf-reb-row').first();
    await expect(rrow).toBeVisible();
    await rrow.click();
    await expect(page.getByTestId('pf-reb-positions')).toBeVisible();
    await expect(page.getByTestId('pf-stack').first()).toBeVisible();
    // доходность выбранной сделки vs SPY
    await expect(page.getByTestId('pf-reb-sel')).toContainText('доходность');

    await request.delete(`/api/researcher/setups?id=${encodeURIComponent(setupId)}`);
  });

  test('автосохранение теста и персист в БД', async ({ page, request }) => {
    const name = `E2E-Сетап-PF2-${Date.now()}`;
    const setupId = await seedSetup(request, name);

    await page.goto('/portfolios');
    await runWizard(page, name);
    await expect(page.getByTestId('portfolio-metrics')).toBeVisible({ timeout: 30000 });

    // автосохранённый тест появился чипом (запасное имя содержит имя сетапа)
    const pchip = page.getByTestId('portfolio-chip').filter({ hasText: name });
    await expect(pchip).toBeVisible({ timeout: 15000 });

    // персист после перезагрузки → открытие пересчитывает
    await page.reload();
    const pchip2 = page.getByTestId('portfolio-chip').filter({ hasText: name });
    await expect(pchip2).toBeVisible({ timeout: 15000 });
    await pchip2.click();
    await expect(page.getByTestId('portfolio-metrics')).toBeVisible({ timeout: 30000 });

    // уборка
    await pchip2.locator('[data-testid="portfolio-chip-del"]').click();
    await expect(page.getByTestId('portfolio-chip').filter({ hasText: name })).toHaveCount(0);
    await request.delete(`/api/researcher/setups?id=${encodeURIComponent(setupId)}`);
  });
});
