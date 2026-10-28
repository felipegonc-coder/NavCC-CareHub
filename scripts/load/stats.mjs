// What the load test measured: how long each step took, which steps the server refused or
// failed, and whether the run kept to its budget (README.md, in this folder).

/**
 * @typedef {'ok' | 'failed' | 'error'} Outcome
 *   ok: done; failed: the server refused it (an unexpected 4xx); error: the server failed (5xx),
 *   dropped the connection or didn't answer in time.
 * @typedef {{ times: number[], failed: number, errors: number }} Tally
 * @typedef {{ step: string, done: number, p50: number, p95: number, max: number, failed: number,
 *   errors: number }} StepSummary
 *   Times in milliseconds, of the steps that were done.
 * @typedef {{ step: string, p95Ms: number }} Budget
 * @typedef {{ passed: boolean, reasons: string[], unchecked: string[] }} Verdict
 */

/** The step the budget is for: what a person waits for when they open a page. */
export const PAGE_OPEN = 'page open';

/**
 * Nearest-rank percentile of values sorted from low to high; 0 when there are none.
 * @param {readonly number[]} sorted
 * @param {number} p from 0 to 100
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? 0;
}

export class Recorder {
  /** @type {Map<string, Tally>} */
  #steps = new Map();
  /** @type {Map<string, number>} */
  #problems = new Map();
  /** @type {Map<string, string>} */
  #skipped = new Map();

  /**
   * @param {string} step
   * @returns {Tally}
   */
  #tally(step) {
    let tally = this.#steps.get(step);
    if (!tally) {
      tally = { times: [], failed: 0, errors: 0 };
      this.#steps.set(step, tally);
    }
    return tally;
  }

  /**
   * @param {string} step
   * @param {Outcome} outcome
   * @param {number} ms only counted when the step was done
   * @param {string} [problem] what went wrong, without IDs or personal data
   */
  record(step, outcome, ms, problem) {
    const tally = this.#tally(step);
    if (outcome === 'ok') tally.times.push(ms);
    else if (outcome === 'failed') tally.failed += 1;
    else tally.errors += 1;
    if (outcome !== 'ok') {
      const key = `${step}: ${problem ?? outcome}`;
      this.#problems.set(key, (this.#problems.get(key) ?? 0) + 1);
    }
  }

  /**
   * A step this server can't do yet (its feature isn't on this build).
   * @param {string} step
   * @param {string} reason
   */
  skip(step, reason) {
    if (!this.#skipped.has(step)) this.#skipped.set(step, reason);
  }

  /** @returns {StepSummary[]} */
  summary() {
    return [...this.#steps].map(([step, { times, failed, errors }]) => {
      const sorted = [...times].sort((a, b) => a - b);
      return {
        step,
        done: sorted.length,
        p50: Math.round(percentile(sorted, 50)),
        p95: Math.round(percentile(sorted, 95)),
        max: Math.round(sorted.at(-1) ?? 0),
        failed,
        errors,
      };
    });
  }

  /** @returns {{ problem: string, count: number }[]} most frequent first */
  problems() {
    return [...this.#problems]
      .map(([problem, count]) => ({ problem, count }))
      .sort((a, b) => b.count - a.count || a.problem.localeCompare(b.problem));
  }

  /** @returns {{ step: string, reason: string }[]} */
  skipped() {
    return [...this.#skipped].map(([step, reason]) => ({ step, reason }));
  }
}

/**
 * Passed when every budgeted step that ran kept to its p95 and no step failed or erred.
 * @param {StepSummary[]} summary
 * @param {readonly Budget[]} budgets
 * @returns {Verdict}
 */
export function verdict(summary, budgets) {
  const reasons = [];
  const unchecked = [];
  for (const budget of budgets) {
    const step = summary.find((entry) => entry.step === budget.step);
    if (!step || step.done === 0) unchecked.push(budget.step);
    else if (step.p95 > budget.p95Ms) {
      reasons.push(`${budget.step} p95 is ${step.p95} ms, over the ${budget.p95Ms} ms budget`);
    }
  }
  const errors = summary.reduce((sum, step) => sum + step.errors, 0);
  const failed = summary.reduce((sum, step) => sum + step.failed, 0);
  if (errors > 0) reasons.push(`${count(errors, 'server error')} (5xx, dropped or too slow)`);
  if (failed > 0) reasons.push(`${count(failed, 'step')} refused (4xx)`);
  return { passed: reasons.length === 0, reasons, unchecked };
}

/**
 * @param {number} n
 * @param {string} noun
 */
export function count(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
