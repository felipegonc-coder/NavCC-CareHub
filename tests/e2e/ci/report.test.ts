import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MARKER,
  NIGHTLY_TITLE,
  publish,
  renderReport,
  screenshotTable,
  summarize,
  tail,
  updateNightlyIssue,
  upsertComment,
} from './report.mjs';

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

describe('tail', () => {
  it('keeps the last lines without colors', () => {
    expect(tail(`one\r\ntwo\n${red('three')}\n\n`, 2)).toBe('two\nthree');
  });
});

describe('screenshotTable', () => {
  it('has a row per screen and a column per project', () => {
    const base = 'https://github.com/o/r/blob/abc/pr-7';
    expect(
      screenshotTable(
        ['notes-phone-dark.png', 'home-desktop-light.png', 'home-phone-dark.png', 'other.png'],
        base,
      ),
    ).toEqual([
      '| Screen | Desktop, light | Desktop, dark | Phone, light | Phone, dark |',
      '| --- | --- | --- | --- | --- |',
      `| home | <a href="${base}/home-desktop-light.png"><img src="${base}/home-desktop-light.png?raw=true" width="180" alt="home, desktop-light"></a> | – | – | <a href="${base}/home-phone-dark.png"><img src="${base}/home-phone-dark.png?raw=true" width="180" alt="home, phone-dark"></a> |`,
      `| notes | – | – | – | <a href="${base}/notes-phone-dark.png"><img src="${base}/notes-phone-dark.png?raw=true" width="180" alt="notes, phone-dark"></a> |`,
    ]);
    expect(screenshotTable(['readme.txt'], base)).toEqual([]);
  });
});

describe('renderReport', () => {
  const input = {
    outcome: 'failure',
    results: summarize(report),
    commit: '0123456789abcdef',
    runUrl: 'https://github.com/o/r/actions/runs/1',
    screenshots: ['home-desktop-light.png'],
    imageBase: 'https://github.com/o/r/blob/abc/pr-7',
    logs: [
      { name: 'End of the test log', text: 'log with ``` fence' },
      { name: 'End of the server log', text: '' },
    ],
  };

  it('lists the failed checks, the screenshots and the end of the logs', () => {
    const text = renderReport(input);
    expect(text.startsWith(`${MARKER}\n### ❌ Browser tests failed\n\n`)).toBe(true);
    expect(text).toContain(
      'Commit `0123456` · 5 passed, 3 failed, 1 flaky, 0 skipped · 1m 23s · [workflow run](https://github.com/o/r/actions/runs/1)',
    );
    expect(text).toContain(
      '- `home /` (desktop-dark, phone-dark): exactly one &lt;main&gt;; no axe violations (WCAG 2.1 A and AA)\n  - image-alt (critical): Images must have alternate text: img\n',
    );
    expect(text).toContain('- Error: Process from config.webServer exited early.');
    expect(text).toContain(
      '<img src="https://github.com/o/r/blob/abc/pr-7/home-desktop-light.png?raw=true"',
    );
    expect(text).toContain(
      '<details><summary>End of the test log</summary>\n\n````text\nlog with ``` fence\n````\n\n</details>',
    );
    expect(text).not.toContain('End of the server log');
  });

  it('leaves out the logs when the tests pass', () => {
    const text = renderReport({
      ...input,
      outcome: 'success',
      results: summarize({ stats: { expected: 4 } }),
    });
    expect(text).toContain('### ✅ Browser tests passed');
    expect(text).toContain('4 passed, 0 failed, 0 flaky, 0 skipped · 0m 0s');
    expect(text).not.toContain('Failed checks');
    expect(text).not.toContain('<details>');
  });

  it('says when the tests did not run or the screenshots are missing', () => {
    const text = renderReport({ ...input, results: null, imageBase: null });
    expect(text).toContain('### ⚠️ Browser tests did not run');
    expect(text).toContain('an earlier step failed, so there are no test results');
    expect(text).toContain('The screenshots could not be published; see the workflow run.');
  });
});

/** Records the calls of the Octokit methods used by report.mjs. */
function fakeGitHub(data: { comments?: object[]; issues?: object[] } = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  const record = (name: string) => async (params: Record<string, unknown>) => {
    calls.push([name, params]);
  };
  const github = {
    paginate: async (list: (params: object) => Promise<{ data: object[] }>, params: object) =>
      (await list(params)).data,
    rest: {
      issues: {
        listComments: async () => ({ data: data.comments ?? [] }),
        listForRepo: async () => ({ data: data.issues ?? [] }),
        createComment: record('createComment'),
        updateComment: record('updateComment'),
        create: record('create'),
        update: record('update'),
      },
    },
  };
  return { github, calls };
}

describe('upsertComment', () => {
  const issue = { owner: 'o', repo: 'r', issue_number: 7 };

  it('updates the bot comment with the marker', async () => {
    const { github, calls } = fakeGitHub({
      comments: [
        { id: 1, body: `quoted ${MARKER}`, user: { type: 'User' } },
        { id: 2, body: `${MARKER}\nold`, user: { type: 'Bot' } },
      ],
    });
    await upsertComment(github, issue, 'new');
    expect(calls).toEqual([
      ['updateComment', { owner: 'o', repo: 'r', comment_id: 2, body: 'new' }],
    ]);
  });

  it('creates the comment the first time', async () => {
    const { github, calls } = fakeGitHub({
      comments: [{ id: 1, body: 'hello', user: { type: 'Bot' } }],
    });
    await upsertComment(github, issue, 'new');
    expect(calls).toEqual([['createComment', { ...issue, body: 'new' }]]);
  });
});

describe('updateNightlyIssue', () => {
  const repository = { owner: 'o', repo: 'r' };
  const open = { number: 9, title: NIGHTLY_TITLE };

  it('opens the issue on the first failure and comments on later ones', async () => {
    const first = fakeGitHub({ issues: [{ number: 3, title: NIGHTLY_TITLE, pull_request: {} }] });
    await updateNightlyIssue(first.github, repository, 'report', false);
    expect(first.calls).toHaveLength(1);
    expect(first.calls[0]?.[0]).toBe('create');
    expect(first.calls[0]?.[1]).toMatchObject({ title: NIGHTLY_TITLE });

    const later = fakeGitHub({ issues: [open] });
    await updateNightlyIssue(later.github, repository, 'report', false);
    expect(later.calls).toEqual([
      ['createComment', { ...repository, issue_number: 9, body: 'report' }],
    ]);
  });

  it('closes the issue when a nightly run passes', async () => {
    const { github, calls } = fakeGitHub({ issues: [open] });
    await updateNightlyIssue(github, repository, 'report', true);
    expect(calls.map(([name]) => name)).toEqual(['createComment', 'update']);
    expect(calls[1]?.[1]).toEqual({
      ...repository,
      issue_number: 9,
      state: 'closed',
      state_reason: 'completed',
    });

    const quiet = fakeGitHub();
    await updateNightlyIssue(quiet.github, repository, 'report', true);
    expect(quiet.calls).toEqual([]);
  });
});

describe('publish', () => {
  const dirs: string[] = [];
  afterEach(() =>
    dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })),
  );

  function workspace() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carehub-e2e-report-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, 'screenshots'));
    fs.writeFileSync(path.join(dir, 'screenshots', 'home-desktop-light.png'), 'png');
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(report));
    fs.writeFileSync(path.join(dir, 'e2e.log'), 'last test line\n');
    return {
      E2E_OUTCOME: 'failure',
      E2E_RESULTS: path.join(dir, 'results.json'),
      E2E_LOG: path.join(dir, 'e2e.log'),
      SERVER_LOG: path.join(dir, 'missing.log'),
      E2E_SCREENSHOTS: path.join(dir, 'screenshots'),
      SCREENSHOT_SHA: 'abc123',
      SCREENSHOT_FOLDER: 'pr-7',
    };
  }
  const context = (eventName: string, payload: object = {}) => ({
    eventName,
    payload,
    repo: { owner: 'o', repo: 'r' },
    serverUrl: 'https://github.com',
    runId: 42,
    sha: 'fedcba9876543210',
  });
  const fakeCore = () => {
    const written: string[] = [];
    const summary = {
      addRaw: (text: string) => (written.push(text), summary),
      write: async () => summary,
    };
    return { core: { summary }, written };
  };

  it('writes the job summary and the pull request comment', async () => {
    const { github, calls } = fakeGitHub();
    const { core, written } = fakeCore();
    const pull_request = { number: 7, head: { sha: '1111111222222' } };
    await publish({
      github,
      core,
      context: context('pull_request', { pull_request }),
      env: workspace(),
    });
    expect(written).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const [name, params] = calls[0] ?? [];
    expect(name).toBe('createComment');
    expect(params).toMatchObject({ owner: 'o', repo: 'r', issue_number: 7 });
    const body = String(params?.body);
    expect(body).toBe(written[0]);
    expect(body).toContain('Commit `1111111`');
    expect(body).toContain('https://github.com/o/r/actions/runs/42');
    expect(body).toContain(
      'https://github.com/o/r/blob/abc123/pr-7/home-desktop-light.png?raw=true',
    );
    expect(body).toContain('last test line');
  });

  it('opens the nightly issue for a failed scheduled run', async () => {
    const { github, calls } = fakeGitHub();
    const env = {
      ...workspace(),
      E2E_RESULTS: '/nonexistent/results.json',
      E2E_OUTCOME: 'skipped',
    };
    await publish({ github, core: fakeCore().core, context: context('schedule'), env });
    expect(calls.map(([name]) => name)).toEqual(['create']);
    expect(String(calls[0]?.[1]?.body)).toContain('Browser tests did not run');
  });
});
