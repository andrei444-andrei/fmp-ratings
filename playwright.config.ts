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
    // Локальная SQLite, чтобы БД (промты/цены) работала в e2e без Turso.
    env: { LOCAL_SQLITE_PATH: 'local.db' },
  },
});
