import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './quality-artifacts/playwright-results',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['line'],
    ['html', { outputFolder: './quality-artifacts/playwright-report', open: 'never' }],
    ['json', { outputFile: './quality-artifacts/playwright-results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3021',
    acceptDownloads: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'npm run dev:api',
      url: 'http://127.0.0.1:3020/api/v1/health/live',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run dev:web',
      url: 'http://127.0.0.1:3021',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
