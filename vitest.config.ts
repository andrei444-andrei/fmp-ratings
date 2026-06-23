import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Юнит-тесты на чистую логику (без сети/браузера): парсер ордеров, пагинация,
// реконструкция позиций/аллокация/атрибуция. Гоняются в node за секунды.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
