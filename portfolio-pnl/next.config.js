const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Репозиторий содержит несколько lockfile'ов (родительский проект + этот).
  // Явно фиксируем корень трассировки на папке проекта.
  outputFileTracingRoot: path.join(__dirname),
};

module.exports = nextConfig;
