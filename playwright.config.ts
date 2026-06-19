import { defineConfig, devices } from '@playwright/test';

// E2E через реальный браузер (требование архитектуры).
// Локально: сначала `npm run build`, затем `npm run test:e2e`
// (поднятый dev/prod-сервер на :3123 переиспользуется).
const PORT = 3123;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // iPhone-вьюпорт/UA, но движок Chromium (webkit в окружении не ставим)
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: {
    command: process.env.CI
      ? `npm run build && npx next start -p ${PORT}`
      : `npx next start -p ${PORT}`,
    url: `${baseURL}/research`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Локальная SQLite + детерминизм: без ключей AIMLAPI/FMP. Дефолтного скрипта в
    // продукте нет — под флагом E2E_ALLOW_CODE сервер принимает Python из тела запроса
    // (его подкладывает сам тест), Python исполняется по-настоящему на синтетических ценах.
    // EODHD_API_KEY проброшен из окружения (если задан) — для интеграционного прогона бэктеста на
    // РЕАЛЬНЫХ данных; по умолчанию пуст → синтетика (детерминированные e2e без ключей).
    env: {
      LOCAL_SQLITE_PATH: 'local.db',
      AIMLAPI_KEY: '',
      FMP_API_KEY: process.env.FMP_API_KEY ?? '',
      EODHD_API_KEY: process.env.EODHD_API_KEY ?? '',
      E2E_ALLOW_CODE: '1',
    },
  },
});
