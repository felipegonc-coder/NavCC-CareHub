import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Runs .github/scripts/ci-report.mjs, which e2e.yml uses for its comment, against a fake GitHub API.
const script = fileURLToPath(new URL('../../../.github/scripts/ci-report.mjs', import.meta.url));
const TITLE = 'Nightly browser tests failing';
const BOT = { login: 'github-actions[bot]' };
const PERSON = { login: 'fictional-person' };
const RUN = 'https://github.example/carehub/fictional/actions/runs/42';

interface Issue {
  number: number;
  title: string;
  body?: string;
  state: string;
  state_reason?: string;
  user: { login: string };
  pull_request?: object;
}
interface Comment {
  id: number;
  issue: number;
  user: { login: string };
  body: string;
}

let issues: Issue[] = [];
let comments: Comment[] = [];
let requests: string[] = [];
let nextId = 10;

/** The part of the issues API that the script uses. */
function handle(
  method: string,
  route: string,
  query: URLSearchParams,
  body: Record<string, string>,
) {
  const id = Number(/\d+/.exec(route)?.[0]);
  const issue = issues.find((item) => item.number === id);
  const comment = comments.find((item) => item.id === id);
  const size = Number(query.get('per_page') ?? 30);
  const page = <T>(items: T[]) =>
    items.slice((Number(query.get('page') ?? 1) - 1) * size).slice(0, size);
  switch (`${method} ${route.replace(/\d+/, ':id')}`) {
    case 'GET /issues':
      return page(issues.filter(({ state }) => state === query.get('state')));
    case 'POST /issues': {
      const created = {
        number: nextId++,
        title: body.title ?? '',
        body: body.body,
        state: 'open',
        user: BOT,
      };
      issues.push(created);
      return created;
    }
    case 'PATCH /issues/:id':
      return issue && Object.assign(issue, body);
    case 'GET /issues/:id/comments':
      return issue && page(comments.filter((item) => item.issue === id));
    case 'POST /issues/:id/comments': {
      const created = { id: nextId++, issue: id, user: BOT, body: body.body ?? '' };
      if (issue) comments.push(created);
      return issue && created;
    }
    case 'PATCH /issues/comments/:id':
      return comment && Object.assign(comment, { body: body.body });
  }
  return undefined;
}

const server = http.createServer((request, response) => {
  let data = '';
  request.on('data', (chunk) => (data += chunk));
  request.on('end', () => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    requests.push(`${request.method} ${url.pathname}${url.search}`);
    const route = url.pathname.replace(/^\/repos\/carehub\/fictional/, '');
    const result =
      request.headers.authorization === 'Bearer fictional-token'
        ? handle(request.method ?? '', route, url.searchParams, data ? JSON.parse(data) : {})
        : undefined;
    response.writeHead(result ? 200 : 404, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result ?? { message: 'Not Found' }));
  });
});

let temp = '';
let api = '';
beforeAll(async () => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-report-'));
  fs.mkdirSync(path.join(temp, 'ci-logs'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  fs.rmSync(temp, { recursive: true, force: true });
});
beforeEach(() => {
  issues = [];
  comments = [];
  requests = [];
  nextId = 10;
  for (const file of fs.readdirSync(path.join(temp, 'ci-logs')))
    fs.rmSync(path.join(temp, 'ci-logs', file));
});

const steps = (outcomes: Record<string, string>) =>
  JSON.stringify(
    Object.fromEntries(Object.entries(outcomes).map(([id, outcome]) => [id, { outcome }])),
  );

/** Runs the script like a workflow step does and returns what it printed. */
async function report(vars: Record<string, string>, logs: Record<string, string> = {}) {
  for (const [id, text] of Object.entries(logs))
    fs.writeFileSync(path.join(temp, 'ci-logs', `${id}.log`), text);
  const { stdout } = await promisify(execFile)(process.execPath, [script], {
    env: {
      PATH: process.env.PATH,
      GITHUB_REPOSITORY: 'carehub/fictional',
      GITHUB_TOKEN: 'fictional-token',
      GITHUB_API_URL: api,
      GITHUB_SERVER_URL: 'https://github.example',
      GITHUB_RUN_ID: '42',
      HEAD_SHA: '0123456789abcdef',
      RUNNER_TEMP: temp,
      ...vars,
    },
  });
  return stdout.trim();
}

describe('.github/scripts/ci-report.mjs', () => {
  it('keeps one comment per report name on the pull request', async () => {
    issues = [
      { number: 7, title: 'feat: fictional', state: 'open', user: PERSON, pull_request: {} },
    ];
    // A full first page, so the script has to read the second one to find its comments.
    comments = Array.from({ length: 100 }, (_, i) => ({
      id: 1000 + i,
      issue: 7,
      user: PERSON,
      body: i === 0 ? 'Quoting <!-- carehub-ci-report --> by hand' : 'Looks good.',
    }));
    const extra = path.join(temp, 'extra.md');
    fs.writeFileSync(extra, '\n12 passed, 1 failed\n\n| Screen |\n| --- |\n');
    const browser = { PR_NUMBER: '7', REPORT_NAME: 'Browser tests', REPORT_EXTRA_FILE: extra };
    const log = Array.from({ length: 150 }, (_, i) => `\u001b[31mline ${i + 1}\u001b[39m\r`).join(
      '\n',
    );

    expect(await report({ PR_NUMBER: '7', STEPS_JSON: steps({ lint: 'success' }) })).toBe(
      'Posted a CI report comment.',
    );
    expect(
      await report(
        { ...browser, STEPS_JSON: steps({ build: 'success', e2e: 'failure' }) },
        { e2e: log },
      ),
    ).toBe('Posted a Browser tests report comment.');
    const [ci, e2e] = comments.slice(100);
    expect(ci?.body).toBe(
      `<!-- carehub-ci-report -->\n\n### ✅ CI passed on 0123456\n\n[Run](${RUN})`,
    );
    expect(
      e2e?.body.startsWith(
        `<!-- carehub-ci-report: browser-tests -->\n\n### ❌ Browser tests failed on 0123456: \`e2e\`\n\n[Run](${RUN})\n\n12 passed, 1 failed\n\n| Screen |\n| --- |\n\n<details open>\n<summary><code>e2e</code>: last 120 lines</summary>\n\n\`\`\`text\nline 31\n`,
      ),
    ).toBe(true);
    expect(e2e?.body).toMatch(/\nline 150\n```\n\n<\/details>$/);
    expect(e2e?.body).not.toContain('\u001b');

    expect(await report({ ...browser, STEPS_JSON: steps({ e2e: 'success' }) })).toBe(
      'Updated the Browser tests report comment.',
    );
    expect(comments).toHaveLength(102);
    expect(comments[101]?.body).toBe(
      `<!-- carehub-ci-report: browser-tests -->\n\n### ✅ Browser tests passed on 0123456\n\n[Run](${RUN})\n\n12 passed, 1 failed\n\n| Screen |\n| --- |`,
    );
    expect(requests).toContain(
      'GET /repos/carehub/fictional/issues/7/comments?per_page=100&page=2',
    );
  });

  it('opens an issue for a failing run without a pull request and closes it on a pass', async () => {
    issues = [
      { number: 1, title: TITLE, state: 'open', user: PERSON }, // opened by a person: left alone
      { number: 2, title: TITLE, state: 'open', user: BOT, pull_request: {} },
    ];
    const nightly = { REPORT_NAME: 'Browser tests', REPORT_ISSUE_TITLE: TITLE };

    expect(await report({ ...nightly, STEPS_JSON: steps({ e2e: 'success' }) })).toBe(
      `Passed, and no issue "${TITLE}" is open; nothing to report.`,
    );
    expect(await report({ ...nightly, STEPS_JSON: steps({ e2e: 'failure' }) })).toBe(
      'Opened issue #10.',
    );
    expect(await report({ ...nightly, STEPS_JSON: steps({ seed: 'failure' }) })).toBe(
      'Commented on issue #10.',
    );
    expect(await report({ ...nightly, STEPS_JSON: steps({ e2e: 'success' }) })).toBe(
      'Closed issue #10.',
    );

    const opened = issues.find(({ number }) => number === 10);
    expect(opened).toMatchObject({ title: TITLE, state: 'closed', state_reason: 'completed' });
    expect(opened?.body).toMatch(
      /^<!-- carehub-ci-report: browser-tests -->\n\n### ❌ Browser tests failed on 0123456: `e2e`\n/,
    );
    expect(opened?.body).toContain('`e2e` failed before writing a log; see the [run]');
    expect(comments.map(({ issue, body }) => [issue, body.split('\n\n')[1]])).toEqual([
      [10, '### ❌ Browser tests failed on 0123456: `seed`'],
      [10, '### ✅ Browser tests passed on 0123456'],
    ]);
    expect(comments[1]?.body).toMatch(/\n\nThis run passed, so the issue is closed\.$/);
    expect(issues.filter(({ state }) => state === 'open').map(({ number }) => number)).toEqual([
      1, 2,
    ]);
  });

  it('does nothing without a pull request or an issue title', async () => {
    expect(await report({ STEPS_JSON: steps({ e2e: 'failure' }) })).toBe(
      'Not a pull request run; nothing to report.',
    );
    expect(requests).toEqual([]);
  });
});
