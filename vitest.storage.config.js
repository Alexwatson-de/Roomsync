import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['tests/storage/**/*.test.js'], testTimeout: 20000, hookTimeout: 30000 },
});
