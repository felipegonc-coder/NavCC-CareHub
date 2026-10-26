// Last step of the workflows in .github/workflows: on pull requests it posts or updates one
// comment (found by its marker) with the result, that is the end of each failed step's log, or
// that every step passed. Agents' GitHub tokens can't read check runs, so this comment is how
// they see CI. Outcomes come from STEPS_JSON (toJSON(steps)), logs from
// $RUNNER_TEMP/ci-logs/<step id>.log.
// Optional:
// - REPORT_NAME: the name in the heading, "CI" by default. Each name has its own marker, so each
//   workflow keeps its own comment.
// - REPORT_EXTRA_FILE: a Markdown file shown below the run link, such as test results.
// - REPORT_ISSUE_TITLE: for runs without a pull request, such as nightly runs. A failure comments
//   on the open issue with this title or opens it; a pass comments on it and closes it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TAIL_LINES = 120;
const MAX_BODY_CHARS = 60_000;
const BOT = 'github-actions[bot]';

const env = process.env;
const name = env.REPORT_NAME?.trim() || 'CI';
const slug = name
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
const MARKER = name === 'CI' ? '<!-- carehub-ci-report -->' : `<!-- carehub-ci-report: ${slug} -->`;
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

/** The first item of a paginated list that matches, or undefined. */
async function findFirst(path, matches) {
  for (let page = 1; ; page += 1) {
    const items = await github(
      'GET',
      `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
    );
    const found = items.find(matches);
    if (found || items.length < 100) return found;
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

/** REPORT_EXTRA_FILE, cut at a line end to at most maxChars, or '' if there is none. */
function extra(maxChars) {
  const file = env.REPORT_EXTRA_FILE;
  if (!file || !existsSync(file)) return '';
  const text = readFileSync(file, 'utf8').trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const end = cut.lastIndexOf('\n') + 1 || maxChars;
  return `${cut.slice(0, end)}\n…the rest is in the [run](${runUrl}).`;
}

function reportBody() {
  const more = extra(MAX_BODY_CHARS / 2);
  if (failed.length === 0)
    return [MARKER, `### ✅ ${name} passed on ${commit}`, `[Run](${runUrl})`, more]
      .filter(Boolean)
      .join('\n\n');
  const budget = Math.floor((MAX_BODY_CHARS - more.length) / failed.length) - 300;
  const names = failed.map((id) => `\`${id}\``).join(', ');
  const sections = failed.map((id) => section(id, budget));
  return [
    MARKER,
    `### ❌ ${name} failed on ${commit}: ${names}`,
    `[Run](${runUrl})`,
    more,
    ...sections,
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function reportOnPullRequest(body) {
  const existing = await findFirst(
    `/issues/${env.PR_NUMBER}/comments`,
    (c) => c.user?.login === BOT && c.body?.includes(MARKER),
  );
  if (existing) {
    await github('PATCH', `/issues/comments/${existing.id}`, { body });
    console.log(`Updated the ${name} report comment.`);
  } else {
    await github('POST', `/issues/${env.PR_NUMBER}/comments`, { body });
    console.log(`Posted a ${name} report comment.`);
  }
}

async function reportOnIssue(title, body) {
  const issue = await findFirst(
    '/issues?state=open',
    (i) => !i.pull_request && i.user?.login === BOT && i.title === title,
  );
  if (failed.length > 0 && issue) {
    await github('POST', `/issues/${issue.number}/comments`, { body });
    console.log(`Commented on issue #${issue.number}.`);
  } else if (failed.length > 0) {
    const note = '_Opened by the run above. Later failures add comments; a pass closes it._';
    const created = await github('POST', '/issues', { title, body: `${body}\n\n${note}` });
    console.log(`Opened issue #${created.number}.`);
  } else if (issue) {
    const note = 'This run passed, so the issue is closed.';
    await github('POST', `/issues/${issue.number}/comments`, { body: `${body}\n\n${note}` });
    await github('PATCH', `/issues/${issue.number}`, {
      state: 'closed',
      state_reason: 'completed',
    });
    console.log(`Closed issue #${issue.number}.`);
  } else {
    console.log(`Passed, and no issue "${title}" is open; nothing to report.`);
  }
}

if (!repo || !env.GITHUB_TOKEN || !(env.PR_NUMBER || env.REPORT_ISSUE_TITLE)) {
  console.log('Not a pull request run; nothing to report.');
} else if (env.PR_NUMBER) {
  await reportOnPullRequest(reportBody());
} else {
  await reportOnIssue(env.REPORT_ISSUE_TITLE, reportBody());
}
