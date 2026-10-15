import { defineConfig } from '@playwright/test';

// Temporary browser profiles isolate tests from the user's localhost data.
export default defineConfig({
  testDir: './tests/browser',
  outputDir: './artifacts/tests/browser',
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:5173', headless: true, viewport: { width: 1280, height: 850 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
});
