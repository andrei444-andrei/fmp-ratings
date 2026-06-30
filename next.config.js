/** @type {import('next').NextConfig} */
const nextConfig = {
  // pyodide грузит свои .asm.js/.wasm по путям из node_modules — не бандлим вебпаком,
  // оставляем внешним require в рантайме.
  serverExternalPackages: ['pyodide'],
  // включаем папку drizzle/ в бандл serverless-функций для /api/admin/migrate
  outputFileTracingIncludes: {
    '/api/admin/migrate': ['./drizzle/**/*'],
    // pyodide (ядро + кэш wheel'ов) в бандл функций, исполняющих Python: скрин-движок
    // researcher (computeAndCache → screenPanel → lib/signals/runner) считает на pyodide.
    '/api/researcher/panel': ['./node_modules/pyodide/**/*'],
    '/api/researcher/warm': ['./node_modules/pyodide/**/*'],
  },
};
module.exports = nextConfig;
