import { test, expect } from '@playwright/test';

// Скринер (/researcher): движок отдаёт ПАНЕЛЬ СДЕЛОК (по-настоящему, на синтетике без ключей),
// условия/разрезы/провал считаются на клиенте. Проверяем сквозной путь.

test.describe('Скринер /researcher', () => {
  test('панель грузится, таблица по тикерам/годам, провал в сделки', async ({ page }) => {
    await page.goto('/researcher');
    await expect(page.getByRole('heading', { name: 'Скринер' })).toBeVisible();
    // Панель сделок подтягивается автоматически (синтетика) → в результатах появляется мета-строка.
    await expect(page.getByText(/Панель:.*сделок/)).toBeVisible({ timeout: 120000 });

    // Дефолтный вид — «Сводно» (консолидированная статистика, без таблицы). Переключаемся на таблицу тикеров.
    await page.getByRole('button', { name: 'По тикерам' }).click();

    // Убираем условия (удаляем блок) → показываются ВСЕ сделки → строки тикеров.
    await page.getByText('удалить блок').click();
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(1);

    // Разрез по годам.
    await page.getByRole('button', { name: 'По годам' }).click();
    await expect(page.locator('table tbody tr').first()).toBeVisible();

    // Назад по тикерам → провал в сделки по клику на строку.
    await page.getByRole('button', { name: 'По тикерам' }).click();
    await page.locator('table tbody tr').first().click();
    await expect(page.getByText('матч-сделки по текущим условиям')).toBeVisible();
    // В drawer тоже график цены с периодами сделок (линия).
    await expect(page.locator('.rsx-drawer').getByTestId('deal-line').first()).toBeVisible({ timeout: 60000 });
  });

  // Создание корзины: модалка → ручной ввод тикеров → сохранение → персист в БД → удаление.
  test('создание корзины через модалку (ручной ввод + сохранение в БД)', async ({ page }) => {
    await page.goto('/researcher');
    await expect(page.getByTestId('panel-meta')).toBeVisible({ timeout: 120000 });

    const name = `E2E-Корзина-${Date.now()}`;
    await page.getByTestId('basket-create-open').click();
    await expect(page.getByTestId('basket-modal')).toBeVisible();
    await page.getByTestId('basket-modal-name').fill(name);
    await page.getByTestId('basket-modal-manual').fill('AAA, BBB, CCC');
    await page.getByTestId('basket-modal-add').click();
    // состав показывается чипами
    await expect(page.getByTestId('basket-modal-draft')).toContainText('AAA');
    await expect(page.getByTestId('basket-modal-draft')).toContainText('CCC');
    await page.getByTestId('basket-modal-save').click();

    // чип корзины появляется в карточке «Вселенная»
    const chip = page.getByTestId('basket-chip').filter({ hasText: name });
    await expect(chip).toBeVisible();

    // персист в БД: после перезагрузки корзина на месте
    await page.reload();
    await expect(page.getByTestId('panel-meta')).toBeVisible({ timeout: 120000 });
    const chip2 = page.getByTestId('basket-chip').filter({ hasText: name });
    await expect(chip2).toBeVisible();

    // чистим за собой — удаляем корзину
    await chip2.locator('.bx').click();
    await expect(page.getByTestId('basket-chip').filter({ hasText: name })).toHaveCount(0);
  });

  // Пресет настроек: сохранить условия → удалить блок → загрузить пресет (условия восстановлены) → персист в БД.
  test('сохранение и загрузка пресета условий', async ({ page }) => {
    await page.goto('/researcher');
    await expect(page.getByTestId('panel-meta')).toBeVisible({ timeout: 120000 });

    // дефолтные условия содержат строки-условия
    expect(await page.locator('.cond').count()).toBeGreaterThan(0);

    const name = `E2E-Пресет-${Date.now()}`;
    await page.getByTestId('preset-save-open').click();
    await page.getByTestId('preset-name-input').fill(name);
    await page.getByTestId('preset-desc-input').fill('импульс + низкая вола');
    await page.getByTestId('preset-save-confirm').click();
    const pchip = page.getByTestId('preset-chip').filter({ hasText: name });
    await expect(pchip).toBeVisible();

    // удаляем блок условий → строк-условий не остаётся
    await page.getByText('удалить блок').click();
    await expect(page.locator('.cond')).toHaveCount(0);

    // загрузка пресета восстанавливает условия
    await pchip.click();
    await expect.poll(async () => await page.locator('.cond').count()).toBeGreaterThan(0);

    // персист в БД: пресет доступен после перезагрузки
    await page.reload();
    await expect(page.getByTestId('panel-meta')).toBeVisible({ timeout: 120000 });
    const pchip2 = page.getByTestId('preset-chip').filter({ hasText: name });
    await expect(pchip2).toBeVisible();
    await pchip2.locator('.bx').click();
    await expect(page.getByTestId('preset-chip').filter({ hasText: name })).toHaveCount(0);
  });

  // График сделок: линии цены по активам с периодами сделок (а не точки).
  test('график сделок рисует линии цены по активам', async ({ page }) => {
    await page.goto('/researcher');
    await expect(page.getByTestId('panel-meta')).toBeVisible({ timeout: 120000 });

    // вид «Сводно» (дефолт) показывает график; убираем условия → сделки есть у всех активов
    await page.getByText('удалить блок').click();
    await expect(page.getByTestId('deal-line-charts')).toBeVisible({ timeout: 60000 });
    // есть хотя бы одна карточка актива и линия цены (SVG path), а не одни точки
    await expect(page.getByTestId('deal-line-chart').first()).toBeVisible();
    await expect(page.getByTestId('deal-line').first()).toBeVisible({ timeout: 60000 });
  });

  // Детальный график: клик по карточке → крупный график; выделение мышью → метрики периода.
  test('детальный график актива: открытие, зум, метрики выделенного периода', async ({ page }) => {
    await page.goto('/researcher');
    await expect(page.getByTestId('panel-meta')).toBeVisible({ timeout: 120000 });
    await page.getByText('удалить блок').click();

    // дождаться загрузки цен (реальная линия), иначе клик попадёт в плейсхолдер «нет цен» (некликабелен)
    await expect(page.getByTestId('deal-line').first()).toBeVisible({ timeout: 60000 });
    const card = page.getByTestId('deal-line-chart').filter({ has: page.getByTestId('deal-line') }).first();
    await card.click();

    // открылся детальный просмотр с крупным графиком
    await expect(page.getByTestId('asset-detail')).toBeVisible({ timeout: 15000 });
    const svg = page.getByTestId('asset-detail-svg');
    await expect(svg).toBeVisible();
    await expect(page.getByTestId('detail-stats')).toBeVisible();

    // выделяем участок графика перетаскиванием → метрики именно этого периода
    const box = (await svg.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5, { steps: 10 });
    await page.mouse.up();

    // появилась кнопка «Приблизить к выделению» (значит выделение зарегистрировано) и метрики на месте
    await expect(page.getByTestId('detail-zoom-sel')).toBeVisible();
    await expect(page.getByTestId('detail-stats')).toBeVisible();
    // зум к выделению работает
    await page.getByTestId('detail-zoom-sel').click();
    await expect(page.getByRole('button', { name: 'Сбросить масштаб' })).toBeEnabled();
  });

  // Сетапы: сохранение находки (рецепт + снимок + поток) в БД, персист, загрузка, удаление.
  test('сетапы: сохранение находки и персист в БД', async ({ page }) => {
    await page.goto('/researcher');
    await expect(page.getByTestId('panel-meta')).toBeVisible({ timeout: 120000 });
    await page.getByText('удалить блок').click(); // все сделки → есть что сохранить

    const name = `E2E-Сетап-${Date.now()}`;
    await page.getByTestId('setup-save-open').click();
    await page.getByTestId('setup-name-input').fill(name);
    await page.getByTestId('setup-desc-input').fill('тестовый сетап');
    await page.getByTestId('setup-save-confirm').click();
    const chip = page.getByTestId('setup-chip').filter({ hasText: name });
    await expect(chip).toBeVisible();

    // персист в БД: после перезагрузки сетап на месте
    await page.reload();
    await expect(page.getByTestId('panel-meta')).toBeVisible({ timeout: 120000 });
    const chip2 = page.getByTestId('setup-chip').filter({ hasText: name });
    await expect(chip2).toBeVisible();

    // загрузка сетапа не падает (вселенная/условия применяются, панель остаётся)
    await chip2.click();
    await expect(page.getByTestId('panel-meta')).toBeVisible({ timeout: 120000 });
    // видно, какой сетап активен: метка в шапке результатов + подсветка чипа
    await expect(page.getByTestId('active-setup')).toBeVisible();

    // чистим за собой
    await page.getByTestId('setup-chip').filter({ hasText: name }).locator('.bx').click();
    await expect(page.getByTestId('setup-chip').filter({ hasText: name })).toHaveCount(0);
  });

  // Полоса-скруббер под графиком: тянем → выбирается период, метрики пересчитываются.
  test('детальный график: полоса-скруббер выбирает период', async ({ page }) => {
    await page.goto('/researcher');
    await expect(page.getByTestId('panel-meta')).toBeVisible({ timeout: 120000 });
    await page.getByText('удалить блок').click();
    // дождаться загрузки цен (реальная линия), затем кликнуть карточку с графиком (не плейсхолдер)
    await expect(page.getByTestId('deal-line').first()).toBeVisible({ timeout: 60000 });
    const card = page.getByTestId('deal-line-chart').filter({ has: page.getByTestId('deal-line') }).first();
    await card.click();

    const strip = page.getByTestId('asset-detail-scrubber');
    await expect(strip).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('asset-detail').getByText(/Весь период/)).toBeVisible();

    // тянем по полосе → создаётся окно периода
    const sb = (await strip.boundingBox())!;
    await page.mouse.move(sb.x + sb.width * 0.35, sb.y + sb.height / 2);
    await page.mouse.down();
    await page.mouse.move(sb.x + sb.width * 0.62, sb.y + sb.height / 2, { steps: 12 });
    await page.mouse.up();

    // период выбран (появилась кнопка приблизить + заголовок «Период …»), метрики на месте
    await expect(page.getByTestId('detail-zoom-sel')).toBeVisible();
    await expect(page.getByTestId('asset-detail').getByText(/Период\s+20\d\d/)).toBeVisible();
    await expect(page.getByTestId('detail-stats')).toBeVisible();
  });
});
