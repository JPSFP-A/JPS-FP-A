// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * JPS FP&A Hub — Playwright config
 * Run against local dev server (npx serve . -p 4300) or production Vercel URL.
 *
 * Local:  BASE_URL=http://localhost:4300 npx playwright test
 * Prod:   BASE_URL=https://jmfinancelab.com npx playwright test
 */
module.exports = defineConfig({
  testDir: './specs',
  fullyParallel: false, // financial data tests should run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 30_000,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4300',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // webServer is optional — only used when running locally
  // webServer: {
  //   command: 'npx serve .. -p 4300',
  //   url: 'http://localhost:4300',
  //   reuseExistingServer: true,
  // },
});
