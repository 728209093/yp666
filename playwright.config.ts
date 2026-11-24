import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 150000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'off',
    screenshot: 'only-on-failure',
    launchOptions: existsSync(chromePath) ? { executablePath: chromePath } : {},
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 960 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } },
  ],
});
