/** @type {import('next').NextConfig} */
const nextConfig = {
  // включаем папку drizzle/ в бандл serverless-функций для /api/admin/migrate
  outputFileTracingIncludes: {
    '/api/admin/migrate': ['./drizzle/**/*'],
  },
};
module.exports = nextConfig;
