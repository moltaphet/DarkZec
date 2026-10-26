import { defineConfig } from '@playwright/test';
const testPort = Number(process.env.PORT ?? 4173);
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  ...(process.env.CI ? { workers: 2 } : {}),
  use: { baseURL: `http://127.0.0.1:${testPort}`, browserName: 'chromium', trace: 'off',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: { command: 'npm run preview', url: `http://127.0.0.1:${testPort}`, reuseExistingServer: !process.env.CI },
  reporter: 'list',
});
