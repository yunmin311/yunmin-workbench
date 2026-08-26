import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'benchmarks',
  timeout: 300_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
});
