import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
const root = fileURLToPath(new URL('../..', import.meta.url));

// The stand-in for Anthropic's API (docs/extras/testing.md#claude), as in e2e.yml.
const claudeStub = 'tests/e2e/extras/claude-stub.ts';
const claudeStubURL = 'http://127.0.0.1:4599';

// Checks that change a workspace-wide setting other tests rely on (the Security switches, require
// 2-step, the last Admin) go in files named *.workspace.e2e.ts. They run in the project
// "workspace": after every other test has finished, one at a time, with the desktop-light
// settings. "workspace" is the teardown of the empty project "setup", which every other project
// depends on; unlike a project in `dependencies`, a teardown runs even when earlier tests failed.
const workspaceFiles = /\.workspace\.e2e\.ts$/;
const apiFiles = /\.api\.e2e\.ts$/;

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
  // In CI, 10 minutes for a pull request and 20 at night (E2E_GLOBAL_TIMEOUT_MINUTES in e2e.yml).
  globalTimeout: ci ? Number(process.env.E2E_GLOBAL_TIMEOUT_MINUTES || 10) * 60_000 : 0,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: { baseURL, actionTimeout: 10_000, navigationTimeout: 15_000, trace: 'on-first-retry' },
  projects: [
    { name: 'setup', testMatch: /ci\/workspace\.setup\.ts$/, teardown: 'workspace' },
    ...Object.entries(formFactors).flatMap(([device, use]) =>
      (['light', 'dark'] as const).map((colorScheme) => ({
        name: `${device}-${colorScheme}`,
        use: { ...use, colorScheme, browserName: 'chromium' as const },
        dependencies: ['setup'],
        // API checks do not depend on the screen size or colors, so they run in one project only.
        testIgnore:
          device === 'desktop' && colorScheme === 'light'
            ? [workspaceFiles]
            : [workspaceFiles, apiFiles],
      })),
    ),
    {
      name: 'workspace',
      testMatch: workspaceFiles,
      use: { ...formFactors.desktop, colorScheme: 'light', browserName: 'chromium' },
      workers: 1,
    },
  ],
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: [
          {
            command: 'node apps/server/dist/index.js',
            cwd: root,
            url: `${baseURL}/api/health`,
            // As in CI: production mode, which needs the public address, the test-only routes, and
            // Claude requests to the stub with a fictional key. DATABASE_URL comes from your
            // environment.
            env: {
              PORT: port,
              HOST: '127.0.0.1',
              NODE_ENV: 'production',
              CAREHUB_PUBLIC_URL: baseURL,
              CAREHUB_TEST_HOOKS: '1',
              ANTHROPIC_API_KEY: 'test-key-not-real',
              ANTHROPIC_BASE_URL: claudeStubURL,
            },
            timeout: 60_000,
            reuseExistingServer: false,
            stdout: 'pipe',
          },
          ...(existsSync(new URL(`../../${claudeStub}`, import.meta.url))
            ? [
                {
                  command: `node ${claudeStub}`,
                  cwd: root,
                  url: `${claudeStubURL}/__requests`,
                  env: { CLAUDE_STUB_PORT: '4599' },
                  timeout: 15_000,
                  reuseExistingServer: false,
                },
              ]
            : []),
        ],
      }),
});
