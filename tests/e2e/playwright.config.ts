import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Browser tests for every screen in screens.ts, on desktop and phone, in light and dark mode.
// Without E2E_BASE_URL, Playwright starts the built server (npm run build first) on a free port.
const ci = Boolean(process.env.CI);

// The main process picks the port once; the workers load this file again and inherit E2E_PORT.
const port = (process.env.E2E_PORT ??= execFileSync(process.execPath, [
  '-e',
  "const s = require('node:net').createServer().listen(0, '127.0.0.1', () => { process.stdout.write(String(s.address().port)); s.close(); });",
]).toString());
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

const formFactors = {
  desktop: {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: devices['Pixel 7'].userAgent,
  },
};

export default defineConfig({
  testDir: '.',
  testMatch: /\.e2e\.ts$/,
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: ci ? '100%' : '50%',
  timeout: 30_000,
  globalTimeout: ci ? 10 * 60_000 : 0,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: { baseURL, actionTimeout: 10_000, navigationTimeout: 15_000, trace: 'on-first-retry' },
  projects: Object.entries(formFactors).flatMap(([device, use]) =>
    (['light', 'dark'] as const).map((colorScheme) => ({
      name: `${device}-${colorScheme}`,
      use: { ...use, colorScheme, browserName: 'chromium' as const },
      // API checks do not depend on the screen size or colors, so they run in one project only.
      ...(device === 'desktop' && colorScheme === 'light' ? {} : { testIgnore: /\.api\.e2e\.ts$/ }),
    })),
  ),
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: 'node apps/server/dist/index.js',
          cwd: fileURLToPath(new URL('../..', import.meta.url)),
          url: `${baseURL}/api/health`,
          env: { PORT: port, HOST: '127.0.0.1' },
          timeout: 60_000,
          reuseExistingServer: false,
          stdout: 'pipe',
        },
      }),
});
