import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';

const browserPath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((path): path is string => Boolean(path && existsSync(path)));

export default defineConfig({
  testDir: './tests/ui',
  timeout: 30000,
  expect: {timeout: 5000},
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5274',
    viewport: {width: 1440, height: 960},
    launchOptions: browserPath ? {executablePath: browserPath} : {},
  },
  webServer: {
    command: 'pnpm --filter @yp666/admin exec vite --host 127.0.0.1 --port 5274',
    url: 'http://127.0.0.1:5274',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
