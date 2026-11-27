// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const PORT = process.env.E2E_PORT || '3901';

module.exports = defineConfig({
  testDir: 'test/e2e',
  // Une seule base partagée : les fichiers s'exécutent l'un après l'autre.
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node test/e2e/serve.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_PORT: PORT },
  },
});
