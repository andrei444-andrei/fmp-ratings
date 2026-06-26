/** @type {import('next').NextConfig} */
const nextConfig = {
  // pyodide грузит свои .asm.js/.wasm по путям из node_modules — не бандлим вебпаком,
  // оставляем внешним require в рантайме.
  serverExternalPackages: ['pyodide'],
  // включаем папку drizzle/ в бандл serverless-функций для /api/admin/migrate
  outputFileTracingIncludes: {
    '/api/admin/migrate': ['./drizzle/**/*'],
    // pyodide (ядро + кэш wheel'ов) в бандл функций исполнения Python
    '/api/signals/study': ['./node_modules/pyodide/**/*'],
  },
};
module.exports = nextConfig;
