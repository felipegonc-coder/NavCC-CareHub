// @ts-check
// The results of the browser tests in Markdown: the counts and the failed checks.
// .github/workflows/e2e.yml adds it to the job summary and, with REPORT_EXTRA_FILE, to the report
// that .github/scripts/ci-report.mjs writes; the publish job adds the screenshots.
// Usage: node tests/e2e/ci/report.mjs > summary.md
// Reads E2E_RESULTS, Playwright's JSON report (by default tests/e2e/test-results/results.json).
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
 * The Markdown for the results.
 *
 * @param {Results | null} results null when the tests did not finish.
 * @returns {string}
 */
export function renderSummary(results) {
  if (!results) return 'No test results: the browser tests did not finish.\n';
  const seconds = Math.round(results.durationMs / 1000);
  const lines = [
    `${results.passed} passed, ${results.failed} failed, ${results.flaky} flaky, ${results.skipped} skipped in ${Math.floor(seconds / 60)}m ${seconds % 60}s`,
  ];
  const { failures, errors } = results;
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
  return `${lines.join('\n')}\n`;
}

/** @param {Record<string, string | undefined>} env */
function main(env) {
  const resultsFile =
    env.E2E_RESULTS || fileURLToPath(new URL('../test-results/results.json', import.meta.url));
  /** @type {unknown} */
  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  } catch {
    // No report, or an unreadable one: no results.
  }
  process.stdout.write(renderSummary(summarize(report)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.env);
