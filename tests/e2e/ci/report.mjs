// @ts-check
// The report of .github/workflows/e2e.yml: one sticky comment on the pull request with the results,
// the screenshots and, on failure, the end of the logs; the same text in the job summary; and for
// nightly runs the issue "Nightly browser tests failing". Called through actions/github-script.
import fs from 'node:fs';

export const MARKER = '<!-- carehub-e2e-report -->';
export const NIGHTLY_TITLE = 'Nightly browser tests failing';
const PROJECTS = ['desktop-light', 'desktop-dark', 'phone-light', 'phone-dark'];

/** @typedef {{ title: string, projects: string[], checks: string[], details: string[] }} Failure */
/** @typedef {{ passed: number, failed: number, flaky: number, skipped: number, durationMs: number, failures: Failure[], errors: string[] }} Results */

/** @param {unknown} value @returns {any[]} */
const list = (value) => (Array.isArray(value) ? value : []);
/** @param {string} text */
// eslint-disable-next-line no-control-regex -- terminal color codes start with ESC
export const stripAnsi = (text) => text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
/** @param {string} text */
const escapeHtml = (text) =>
  text.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char] ?? char);
/** @param {unknown} error */
const messageOf = (error) =>
  stripAnsi(
    String(typeof error === 'object' && error && 'message' in error ? error.message : error),
  );

/**
 * The counts and failed checks in Playwright's JSON report; null when there is no report.
 * Failures with the same checks are grouped across projects.
 *
 * @param {unknown} report
 * @returns {Results | null}
 */
export function summarize(report) {
  const stats = typeof report === 'object' && report && 'stats' in report ? report.stats : null;
  if (typeof stats !== 'object' || stats === null) return null;
  const data = /** @type {Record<string, unknown>} */ (report);
  const count = (/** @type {string} */ key) => {
    const value = /** @type {Record<string, unknown>} */ (stats)[key];
    return typeof value === 'number' ? value : 0;
  };
  /** @type {Map<string, Failure>} */
  const failures = new Map();
  /** @param {any} suite @param {string[]} titles */
  const walk = (suite, titles) => {
    for (const spec of list(suite.specs)) {
      for (const test of list(spec.tests).filter((item) => item.status === 'unexpected')) {
        const messages = list(list(test.results).at(-1)?.errors).map(messageOf);
        const checks = messages.map((text) =>
          (text.split('\n')[0] ?? '').replace(/^Error: /, '').trim(),
        );
        const details = messages.flatMap((text) =>
          [...text.matchAll(/^\+ {3}"(.+)",?$/gm)].map((match) => match[1] ?? ''),
        );
        const title = [...titles, String(spec.title)].join(' › ');
        const key = JSON.stringify([title, checks, details]);
        const failure = failures.get(key) ?? { title, projects: [], checks, details };
        failure.projects.push(String(test.projectName));
        failures.set(key, failure);
      }
    }
    for (const child of list(suite.suites)) walk(child, [...titles, String(child.title)]);
  };
  for (const file of list(data.suites)) walk(file, []);
  return {
    passed: count('expected'),
    failed: count('unexpected'),
    flaky: count('flaky'),
    skipped: count('skipped'),
    durationMs: count('duration'),
    failures: [...failures.values()],
    errors: list(data.errors).map((error) => messageOf(error).split('\n')[0] ?? ''),
  };
}

/**
 * The last lines of a log, without colors.
 *
 * @param {string} text
 * @param {number} [lines]
 */
export function tail(text, lines = 60) {
  const all = stripAnsi(text).replace(/\r\n?/g, '\n').trimEnd().split('\n');
  return all.slice(-lines).join('\n').slice(-8000);
}

/**
 * A table with one row per screen and one column per project; images link to the full size.
 *
 * @param {string[]} files Names like home-phone-dark.png.
 * @param {string} imageBase URL of the folder on the ci-screenshots branch.
 * @returns {string[]} Markdown lines.
 */
export function screenshotTable(files, imageBase) {
  /** @type {Map<string, Map<string, string>>} */
  const screens = new Map();
  for (const file of [...files].sort()) {
    const [, screen, project] = /^(.+)-((?:desktop|phone)-(?:light|dark))\.png$/.exec(file) ?? [];
    if (screen && project)
      screens.set(screen, (screens.get(screen) ?? new Map()).set(project, file));
  }
  const rows = [...screens].map(([screen, byProject]) => {
    const cells = PROJECTS.map((project) => {
      const file = byProject.get(project);
      const url = `${imageBase}/${encodeURIComponent(file ?? '')}`;
      return file
        ? `<a href="${url}"><img src="${url}?raw=true" width="180" alt="${screen}, ${project}"></a>`
        : '–';
    });
    return `| ${screen} | ${cells.join(' | ')} |`;
  });
  if (rows.length === 0) return [];
  return [
    '| Screen | Desktop, light | Desktop, dark | Phone, light | Phone, dark |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ];
}

/**
 * @typedef {object} ReportInput
 * @property {string} outcome Of the test step: success, failure, cancelled or skipped.
 * @property {Results | null} results
 * @property {string} commit
 * @property {string} runUrl
 * @property {string[]} screenshots File names.
 * @property {string | null} imageBase Null when the screenshots could not be published.
 * @property {{ name: string, text: string }[]} logs Shown when the run did not pass.
 */

/** @param {ReportInput} input @returns {string} Markdown. */
export function renderReport({ outcome, results, commit, runUrl, screenshots, imageBase, logs }) {
  const passed = outcome === 'success';
  const heading = passed
    ? '✅ Browser tests passed'
    : results
      ? '❌ Browser tests failed'
      : '⚠️ Browser tests did not run';
  const seconds = Math.round((results?.durationMs ?? 0) / 1000);
  const facts = results
    ? [
        `${results.passed} passed, ${results.failed} failed, ${results.flaky} flaky, ${results.skipped} skipped`,
        `${Math.floor(seconds / 60)}m ${seconds % 60}s`,
      ]
    : ['an earlier step failed, so there are no test results'];
  const lines = [
    MARKER,
    `### ${heading}`,
    '',
    [`Commit \`${commit.slice(0, 7)}\``, ...facts, `[workflow run](${runUrl})`].join(' · '),
  ];

  const failures = results?.failures ?? [];
  const errors = results?.errors ?? [];
  if (failures.length > 0 || errors.length > 0) {
    lines.push('', '**Failed checks**', '');
    for (const { title, projects, checks, details } of failures.slice(0, 20)) {
      lines.push(
        `- \`${title}\` (${projects.join(', ')}): ${escapeHtml(checks.join('; ') || 'failed')}`,
      );
      lines.push(...details.slice(0, 5).map((detail) => `  - ${escapeHtml(detail)}`));
    }
    if (failures.length > 20)
      lines.push(`- and ${failures.length - 20} more, see the workflow run`);
    lines.push(...errors.map((error) => `- ${escapeHtml(error)}`));
  }

  if (screenshots.length > 0) {
    const table = imageBase ? screenshotTable(screenshots, imageBase) : [];
    lines.push('', '**Screenshots** (desktop 1280×800, phone 390×844)', '');
    lines.push(
      ...(table.length > 0
        ? table
        : ['The screenshots could not be published; see the workflow run.']),
    );
  }

  for (const { name, text } of passed ? [] : logs.filter((log) => log.text !== '')) {
    const fence = '`'.repeat(
      Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1)),
    );
    lines.push(
      '',
      `<details><summary>${name}</summary>`,
      '',
      `${fence}text`,
      text,
      fence,
      '',
      '</details>',
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Creates the sticky comment on the pull request or updates it.
 *
 * @param {any} github Octokit from actions/github-script.
 * @param {{ owner: string, repo: string, issue_number: number }} issue
 * @param {string} body
 */
export async function upsertComment(github, issue, body) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...issue,
    per_page: 100,
  });
  const mine = list(comments).find(
    (comment) => comment.user?.type === 'Bot' && String(comment.body).includes(MARKER),
  );
  if (mine)
    await github.rest.issues.updateComment({
      owner: issue.owner,
      repo: issue.repo,
      comment_id: mine.id,
      body,
    });
  else await github.rest.issues.createComment({ ...issue, body });
}

/**
 * Nightly runs: a failure opens the issue or comments on it; a pass closes it.
 *
 * @param {any} github
 * @param {{ owner: string, repo: string }} repository
 * @param {string} body
 * @param {boolean} passed
 */
export async function updateNightlyIssue(github, repository, body, passed) {
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    ...repository,
    state: 'open',
    per_page: 100,
  });
  const open = list(issues).find((issue) => issue.title === NIGHTLY_TITLE && !issue.pull_request);
  if (open && passed) {
    await github.rest.issues.createComment({
      ...repository,
      issue_number: open.number,
      body: `${body}\nThe nightly run passes again, so this issue is closed.\n`,
    });
    await github.rest.issues.update({
      ...repository,
      issue_number: open.number,
      state: 'closed',
      state_reason: 'completed',
    });
  } else if (open) {
    await github.rest.issues.createComment({ ...repository, issue_number: open.number, body });
  } else if (!passed) {
    const note =
      '_Opened by .github/workflows/e2e.yml. Later failures are added as comments; a passing nightly run closes this issue._';
    await github.rest.issues.create({
      ...repository,
      title: NIGHTLY_TITLE,
      body: `${body}\n${note}\n`,
    });
  }
}

/**
 * Entry point for actions/github-script. Reads the paths and step results from the environment:
 * E2E_OUTCOME, E2E_RESULTS, E2E_LOG, SERVER_LOG, E2E_SCREENSHOTS, SCREENSHOT_SHA, SCREENSHOT_FOLDER.
 *
 * @param {{ github: any, context: any, core: any, env?: Record<string, string | undefined> }} options
 */
export async function publish({ github, context, core, env = process.env }) {
  const read = (/** @type {string | undefined} */ file) =>
    file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  /** @type {unknown} */
  let report = null;
  try {
    report = JSON.parse(read(env.E2E_RESULTS) || 'null');
  } catch {
    // An unreadable report counts as no report.
  }
  const folder = env.E2E_SCREENSHOTS ?? '';
  const { owner, repo } = context.repo;
  const repoUrl = `${context.serverUrl}/${owner}/${repo}`;
  const pullRequest = context.payload.pull_request;
  const outcome = env.E2E_OUTCOME || 'skipped';
  const body = renderReport({
    outcome,
    results: summarize(report),
    commit: pullRequest?.head?.sha ?? context.sha,
    runUrl: `${repoUrl}/actions/runs/${context.runId}`,
    screenshots:
      folder && fs.existsSync(folder)
        ? fs.readdirSync(folder).filter((file) => file.endsWith('.png'))
        : [],
    imageBase:
      env.SCREENSHOT_SHA && env.SCREENSHOT_FOLDER
        ? `${repoUrl}/blob/${env.SCREENSHOT_SHA}/${env.SCREENSHOT_FOLDER}`
        : null,
    logs: [
      { name: 'End of the test log', text: tail(read(env.E2E_LOG)) },
      { name: 'End of the server log', text: tail(read(env.SERVER_LOG), 30) },
    ],
  });
  await core.summary.addRaw(body).write();
  if (pullRequest)
    await upsertComment(github, { owner, repo, issue_number: pullRequest.number }, body);
  else if (context.eventName === 'schedule')
    await updateNightlyIssue(github, { owner, repo }, body, outcome === 'success');
}
