// The load test's report: Markdown for people (and the CI job summary), JSON for scripts.
import { count } from './stats.mjs';

/**
 * @typedef {import('./client.mjs').Answer} Answer
 * @typedef {{ count: number, bytes: number, largest: { path: string, bytes: number },
 *   compressed: number, longCache: number }} Files
 * @typedef {object} Report
 * @property {string} startedAt
 * @property {string} url
 * @property {string | null} version the build's CAREHUB_VERSION, from /api/health
 * @property {number} people
 * @property {number} durationS
 * @property {number} budgetMs
 * @property {import('./stats.mjs').StepSummary[]} steps
 * @property {{ step: string, reason: string }[]} skipped
 * @property {{ problem: string, count: number }[]} problems
 * @property {Files | null} files what one first visit downloaded
 * @property {import('./stats.mjs').Verdict} verdict
 */

/** Long enough to count as a long cache time: about 12 days or more, or `immutable`. */
const LONG_CACHE = /immutable|max-age=\d{7,}/;
const MAX_PROBLEMS = 20;

/**
 * @param {{ answer: Answer }} file
 * @param {string} name
 */
const header = (file, name) => file.answer.headers.get(name) ?? '';

/**
 * @param {{ path: string, answer: Answer }[]} files
 * @returns {Files | null}
 */
export function filesSummary(files) {
  const [first] = files;
  if (!first) return null;
  const largest = files.reduce((big, file) => (file.answer.bytes > big.answer.bytes ? file : big));
  return {
    count: files.length,
    bytes: files.reduce((sum, file) => sum + file.answer.bytes, 0),
    largest: { path: largest.path, bytes: largest.answer.bytes },
    compressed: files.filter((file) => header(file, 'content-encoding') !== '').length,
    longCache: files.filter((file) => LONG_CACHE.test(header(file, 'cache-control'))).length,
  };
}

/** @param {number} bytes */
const kb = (bytes) => `${Math.round(bytes / 1024).toLocaleString('en-US')} KB`;

/** @param {Report} report */
export function markdown(report) {
  const { verdict, steps, files } = report;
  const who = `${report.people} ${report.people === 1 ? 'person' : 'people'}`;
  const pageOpen = steps.find((step) => step.step === 'page open');
  let result;
  if (!verdict.passed) result = `**Failed:** ${verdict.reasons.join('; ')}.`;
  else if (pageOpen && pageOpen.done > 0) {
    result = `**Passed:** page open p95 is ${pageOpen.p95} ms (budget ${report.budgetMs} ms), with no refused steps or server errors.`;
  } else
    result = '**Not checked:** no page opened on this build. No refused steps or server errors.';
  const lines = [
    `### Load test: ${who} for ${report.durationS} s`,
    '',
    result,
    '',
    '| Step | Done | p50 | p95 | Max | Refused | Errors |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...steps.map(
      (s) =>
        `| ${s.step} | ${s.done} | ${s.p50} ms | ${s.p95} ms | ${s.max} ms | ${s.failed} | ${s.errors} |`,
    ),
  ];
  if (report.skipped.length > 0) {
    lines.push('', 'Not on this build yet, so not measured:', '');
    for (const { step, reason } of report.skipped) lines.push(`- ${step}: ${reason}`);
  }
  if (files) {
    lines.push(
      '',
      `First visit: ${count(files.count, 'file')}, ${kb(files.bytes)} after decompression (largest: \`${files.largest.path}\`, ${kb(files.largest.bytes)}); compressed: ${files.compressed} of ${files.count}; with a long cache time: ${files.longCache} of ${files.count}.`,
    );
  }
  if (report.problems.length > 0) {
    lines.push('', 'Problems, most frequent first:', '');
    for (const { problem, count: n } of report.problems.slice(0, MAX_PROBLEMS)) {
      lines.push(`- ${problem} (${count(n, 'time')})`);
    }
    const more = report.problems.length - MAX_PROBLEMS;
    if (more > 0) lines.push(`- and ${count(more, 'other problem')} (in load-report.json)`);
  }
  const build = report.version ? `Build ${report.version}` : 'A build without a version';
  lines.push('', `${build} at ${report.url}, started ${report.startedAt}.`, '');
  return lines.join('\n');
}
