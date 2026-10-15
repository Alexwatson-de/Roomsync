import { defineConfig } from '@playwright/test';
// Isolated Auth/Firestore only. No Storage emulator, bucket or billing needed.
export default defineConfig({
  testDir: './tests/firebase-browser',
  outputDir: './artifacts/tests/firebase-browser',
  timeout: 60000,
  workers: 1,
  use: { baseURL: 'http://localhost:5174', headless: true, viewport: { width: 1366, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 5174',
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    env: { VITE_FIREBASE_PROJECT_ID: 'demo-roomsync', VITE_FIREBASE_API_KEY: 'fake-emulator-key', VITE_FIREBASE_AUTH_DOMAIN: 'demo-roomsync.firebaseapp.com', VITE_FIREBASE_APP_ID: '1:123:web:test', VITE_USE_FIREBASE_EMULATORS: 'true' },
  },
});
