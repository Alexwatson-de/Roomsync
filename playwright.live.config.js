import { defineConfig } from '@playwright/test';
// Explicit live integration check, never part of CI or the default test suite.
// Creates only marked disposable accounts/households; all IDs are recorded in
// ignored artifacts so the authenticated administrator can remove just those.
export default defineConfig({
  testDir: './tests/live-firebase',
  outputDir: './artifacts/tests/live-firebase',
  timeout: 180000,
  workers: 1,
  retries: 0,
  use: { baseURL: 'http://localhost:5173', headless: true, viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
});
