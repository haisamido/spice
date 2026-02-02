import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    globals: false,
    environment: 'node',
    testTimeout: 30000,
  },
});
