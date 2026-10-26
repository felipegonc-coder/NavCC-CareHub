// @ts-check
// The results of the browser tests in Markdown: the counts, the failed checks and a table with the
// screenshots. .github/workflows/e2e.yml adds it to the job summary and, with REPORT_EXTRA_FILE,
// to the comment that .github/scripts/ci-report.mjs writes on the pull request.
// Usage: node tests/e2e/ci/report.mjs > report.md
// Reads E2E_RESULTS (Playwright's JSON report), E2E_SCREENSHOTS (the folder with the PNG files),
// SCREENSHOT_SHA and SCREENSHOT_FOLDER (where push-screenshots.sh put them; unset when that
// failed), GITHUB_SERVER_URL and GITHUB_REPOSITORY.
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECTS = ['desktop-light', 'desktop-dark', 'phone-light', 'phone-dark'];
const MAX_FAILURES = 20;

/** @typedef {{ title: string, projects: string[], checks: string[], details: string[] }} Failure */
/** @typedef {{ passed: number, failed: number, flaky: number, skipped: number, durationMs: number, failures: Failure[], errors: string[] }} Results */

/** @param {unknown} value @returns {any[]} */
const list = (value) => (Array.isArray(value) ? value : []);
/** @param {string} text */
// eslint-disable-next-line no-control-regex -- terminal color codes start with ESC
const stripAnsi = (text) => text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
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
 * The Markdown for the results and the screenshots; '' when there are neither.
 *
 * @param {{ results: Results | null, screenshots: string[], imageBase: string | null }} input
 *   `screenshots` are file names; `imageBase` is null when they could not be published.
 * @returns {string}
 */
export function renderSummary({ results, screenshots, imageBase }) {
  if (!results && screenshots.length === 0) return '';
  const seconds = Math.round((results?.durationMs ?? 0) / 1000);
  const lines = [
    results
      ? `${results.passed} passed, ${results.failed} failed, ${results.flaky} flaky, ${results.skipped} skipped in ${Math.floor(seconds / 60)}m ${seconds % 60}s`
      : 'No test results: the browser tests did not finish.',
  ];

  const failures = results?.failures ?? [];
  const errors = results?.errors ?? [];
  if (failures.length > 0 || errors.length > 0) {
    lines.push('', '**Failed checks**', '');
    for (const { title, projects, checks, details } of failures.slice(0, MAX_FAILURES)) {
      lines.push(
        `- \`${title}\` (${projects.join(', ')}): ${escapeHtml(checks.join('; ') || 'failed')}`,
      );
      lines.push(...details.slice(0, 5).map((detail) => `  - ${escapeHtml(detail)}`));
    }
    if (failures.length > MAX_FAILURES)
      lines.push(`- and ${failures.length - MAX_FAILURES} more, see the run`);
    lines.push(...errors.map((error) => `- ${escapeHtml(error)}`));
  }

  if (screenshots.length > 0) {
    const table = imageBase ? screenshotTable(screenshots, imageBase) : [];
    lines.push('', '**Screenshots** (desktop 1280×800, phone 390×844)', '');
    lines.push(
      ...(table.length > 0 ? table : ['The screenshots could not be published; see the run.']),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** @param {Record<string, string | undefined>} env */
function main(env) {
  const resultsFile =
    env.E2E_RESULTS || fileURLToPath(new URL('../test-results/results.json', import.meta.url));
  const folder = env.E2E_SCREENSHOTS || fileURLToPath(new URL('../screenshots/', import.meta.url));
  /** @type {unknown} */
  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  } catch {
    // No report, or an unreadable one: no results.
  }
  const repoUrl = `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}`;
  const text = renderSummary({
    results: summarize(report),
    screenshots: fs.existsSync(folder)
      ? fs.readdirSync(folder).filter((file) => file.endsWith('.png'))
      : [],
    imageBase:
      env.SCREENSHOT_SHA && env.SCREENSHOT_FOLDER
        ? `${repoUrl}/blob/${env.SCREENSHOT_SHA}/${env.SCREENSHOT_FOLDER}`
        : null,
  });
  process.stdout.write(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.env);
