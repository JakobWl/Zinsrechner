import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: '**/*.spec.ts', workers: 1,
  timeout: 45000, expect: { timeout: 10000 },
  outputDir: '.jait/artifacts/playwright-results',
  reporter: [['list'], ['html', { outputFolder: '.jait/artifacts/playwright-report', open: 'never' }]],
  webServer: { command: 'npm run dev:web', url: 'http://127.0.0.1:7777', reuseExistingServer: false, env: { NODE_ENV: 'development' } },
  use: { baseURL: 'http://127.0.0.1:7777', viewport: { width: 1600, height: 1000 }, trace: 'retain-on-failure', screenshot: 'off' },
});
