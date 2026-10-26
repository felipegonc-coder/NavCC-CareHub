// Last step of .github/workflows/ci.yml on pull requests: posts or updates one comment
// (found by MARKER) with the end of each failed step's log, and marks it as passed once every
// step succeeds. Outcomes come from STEPS_JSON (toJSON(steps)), logs from
// $RUNNER_TEMP/ci-logs/<step id>.log.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MARKER = '<!-- carehub-ci-report -->';
const TAIL_LINES = 120;
const MAX_BODY_CHARS = 60_000;

const env = process.env;
const repo = env.GITHUB_REPOSITORY;
const api = env.GITHUB_API_URL ?? 'https://api.github.com';
const runUrl = `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/actions/runs/${env.GITHUB_RUN_ID}`;
const commit = (env.HEAD_SHA ?? '').slice(0, 7);
const steps = JSON.parse(env.STEPS_JSON ?? '{}');
const failed = Object.keys(steps).filter((id) => steps[id]?.outcome === 'failure');
const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

async function github(method, path, body) {
  const response = await fetch(`${api}/repos/${repo}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'content-type': 'application/json',
    },
    body: body && JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function findComment() {
  for (let page = 1; ; page += 1) {
    const comments = await github(
      'GET',
      `/issues/${env.PR_NUMBER}/comments?per_page=100&page=${page}`,
    );
    const found = comments.find(
      (c) => c.user?.login === 'github-actions[bot]' && c.body?.includes(MARKER),
    );
    if (found || comments.length < 100) return found;
  }
}

/** The last TAIL_LINES lines of a step's log, at most maxChars long, or null if none. */
function logTail(id, maxChars) {
  const file = join(env.RUNNER_TEMP ?? '.', 'ci-logs', `${id}.log`);
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, 'utf8')
    .replace(ansi, '')
    .split('\n')
    .map((line) => line.replace(/\r+$/, '').split('\r').pop());
  const tail = lines.slice(-TAIL_LINES).join('\n').trimEnd();
  return tail.length > maxChars ? `…${tail.slice(-maxChars)}` : tail;
}

function section(id, maxChars) {
  const tail = logTail(id, maxChars);
  if (tail === null) return `\`${id}\` failed before writing a log; see the [run](${runUrl}).`;
  const longestRun = Math.max(0, ...Array.from(tail.matchAll(/`+/g), (m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  const summary = `<summary><code>${id}</code>: last ${TAIL_LINES} lines</summary>`;
  return `<details open>\n${summary}\n\n${fence}text\n${tail}\n${fence}\n\n</details>`;
}

if (!repo || !env.GITHUB_TOKEN || !env.PR_NUMBER) {
  console.log('Not a pull request run; nothing to report.');
} else {
  const existing = await findComment();
  let body;
  if (failed.length > 0) {
    const budget = Math.floor(MAX_BODY_CHARS / failed.length) - 300;
    const names = failed.map((id) => `\`${id}\``).join(', ');
    const sections = failed.map((id) => section(id, budget));
    body = [
      MARKER,
      `### ❌ CI failed on ${commit}: ${names}`,
      `[Run](${runUrl})`,
      ...sections,
    ].join('\n\n');
  } else if (existing) {
    body = `${MARKER}\n\n### ✅ CI passed on ${commit}\n\n[Run](${runUrl})`;
  }
  if (!body) {
    console.log('All steps passed.');
  } else if (existing) {
    await github('PATCH', `/issues/comments/${existing.id}`, { body });
    console.log('Updated the CI report comment.');
  } else {
    await github('POST', `/issues/${env.PR_NUMBER}/comments`, { body });
    console.log('Posted a CI report comment.');
  }
}
