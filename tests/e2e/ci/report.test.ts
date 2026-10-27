import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderSummary, summarize } from './report.mjs';

const red = (text: string) => `\u001b[31m${text}\u001b[39m`;
const failed = (projectName: string, ...messages: string[]) => ({
  projectName,
  status: 'unexpected',
  results: [
    { errors: [{ message: 'Error: first try' }] },
    { errors: messages.map((message) => ({ message })) },
  ],
});
const axeMessage = `Error: no axe violations (WCAG 2.1 A and AA)\n\n${red('expect(received)')}\n\n- Array []\n+ Array [\n+   "image-alt (critical): Images must have alternate text: img",\n+ ]`;

/** Shaped like the JSON reporter output of Playwright. */
const report = {
  stats: { expected: 5, unexpected: 3, flaky: 1, skipped: 0, duration: 83_400 },
  errors: [{ message: red('Error: Process from config.webServer exited early.') + '\nmore' }],
  suites: [
    {
      title: 'screens.e2e.ts',
      specs: [
        {
          title: 'home /',
          tests: [
            { projectName: 'desktop-light', status: 'expected', results: [] },
            failed('desktop-dark', 'Error: exactly one <main>\n\nExpected: 1', axeMessage),
            failed('phone-dark', 'Error: exactly one <main>\n\nExpected: 1', axeMessage),
            { projectName: 'phone-light', status: 'flaky', results: [] },
          ],
        },
      ],
      suites: [
        {
          title: 'signed in',
          specs: [
            {
              title: 'notes /notes',
              tests: [failed('phone-light', 'Test timeout of 30000ms exceeded.')],
            },
          ],
        },
      ],
    },
  ],
};

describe('summarize', () => {
  it('counts the tests and groups the same failure across projects', () => {
    expect(summarize(report)).toEqual({
      passed: 5,
      failed: 3,
      flaky: 1,
      skipped: 0,
      durationMs: 83_400,
      failures: [
        {
          title: 'home /',
          projects: ['desktop-dark', 'phone-dark'],
          checks: ['exactly one <main>', 'no axe violations (WCAG 2.1 A and AA)'],
          details: ['image-alt (critical): Images must have alternate text: img'],
        },
        {
          title: 'signed in › notes /notes',
          projects: ['phone-light'],
          checks: ['Test timeout of 30000ms exceeded.'],
          details: [],
        },
      ],
      errors: ['Error: Process from config.webServer exited early.'],
    });
  });

  it('returns null without a report', () => {
    expect(summarize(null)).toBeNull();
    expect(summarize({ suites: [] })).toBeNull();
  });
});

describe('renderSummary', () => {
  it('lists the counts and the failed checks', () => {
    const text = renderSummary(summarize(report));
    expect(
      text.startsWith('5 passed, 3 failed, 1 flaky, 0 skipped in 1m 23s\n\n**Failed checks**\n\n'),
    ).toBe(true);
    expect(text).toContain(
      '- `home /` (desktop-dark, phone-dark): exactly one &lt;main&gt;; no axe violations (WCAG 2.1 A and AA)\n  - image-alt (critical): Images must have alternate text: img\n',
    );
    expect(text).toContain(
      '- `signed in › notes /notes` (phone-light): Test timeout of 30000ms exceeded.\n',
    );
    expect(text.endsWith('- Error: Process from config.webServer exited early.\n')).toBe(true);
  });

  it('leaves out what is not there', () => {
    expect(renderSummary(summarize({ stats: { expected: 4 } }))).toBe(
      '4 passed, 0 failed, 0 flaky, 0 skipped in 0m 0s\n',
    );
    expect(renderSummary(null)).toBe('No test results: the browser tests did not finish.\n');
  });
});

describe('report.mjs', () => {
  it('prints the summary of the file named in E2E_RESULTS', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carehub-e2e-report-'));
    try {
      fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(report));
      const script = fileURLToPath(new URL('./report.mjs', import.meta.url));
      const run = (file: string) =>
        execFileSync(process.execPath, [script], {
          encoding: 'utf8',
          env: { PATH: process.env.PATH, E2E_RESULTS: path.join(dir, file) },
        });
      expect(run('results.json').startsWith('5 passed, 3 failed')).toBe(true);
      expect(run('missing.json')).toBe('No test results: the browser tests did not finish.\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
