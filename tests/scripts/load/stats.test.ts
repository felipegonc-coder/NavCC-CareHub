import { describe, expect, it } from 'vitest';
import type { Answer } from '../../../scripts/load/client.mjs';
import { filesSummary, markdown, type Report } from '../../../scripts/load/report.mjs';
import { PAGE_OPEN, Recorder, percentile, verdict } from '../../../scripts/load/stats.mjs';

const budgets = [{ step: PAGE_OPEN, p95Ms: 1000 }];

describe('percentile', () => {
  it('takes the nearest rank', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 100)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([], 95)).toBe(0);
  });
});

describe('Recorder and verdict', () => {
  it('counts done, refused and failed steps, with times only for the done ones', () => {
    const recorder = new Recorder();
    for (const ms of [100, 300, 200]) recorder.record(PAGE_OPEN, 'ok', ms);
    recorder.record(PAGE_OPEN, 'failed', 5, 'GET /api/pages/:id answered 403');
    recorder.record(PAGE_OPEN, 'error', 10_000, 'GET /api/pages/:id: no answer within 10 s');
    recorder.record('search', 'error', 20, 'POST /api/search/query answered 500');
    recorder.record('search', 'error', 20, 'POST /api/search/query answered 500');
    expect(recorder.summary()).toEqual([
      { step: PAGE_OPEN, done: 3, p50: 200, p95: 300, max: 300, failed: 1, errors: 1 },
      { step: 'search', done: 0, p50: 0, p95: 0, max: 0, failed: 0, errors: 2 },
    ]);
    expect(recorder.problems()[0]).toEqual({
      problem: 'search: POST /api/search/query answered 500',
      count: 2,
    });
    expect(verdict(recorder.summary(), budgets)).toEqual({
      passed: false,
      reasons: ['3 server errors (5xx, dropped or too slow)', '1 step refused (4xx)'],
      unchecked: [],
    });
  });

  it('passes within the budget, fails over it and says when a budget was not checked', () => {
    const recorder = new Recorder();
    recorder.record(PAGE_OPEN, 'ok', 999.6);
    expect(verdict(recorder.summary(), budgets)).toEqual({
      passed: true,
      reasons: [],
      unchecked: [],
    });
    recorder.record(PAGE_OPEN, 'ok', 1400);
    expect(verdict(recorder.summary(), budgets).reasons).toEqual([
      'page open p95 is 1400 ms, over the 1000 ms budget',
    ]);
    expect(verdict([], budgets)).toEqual({ passed: true, reasons: [], unchecked: [PAGE_OPEN] });
  });

  it('keeps the first reason a step was skipped', () => {
    const recorder = new Recorder();
    recorder.skip('search', 'needs sign-in');
    recorder.skip('search', 'needs POST /api/search/query');
    expect(recorder.skipped()).toEqual([{ step: 'search', reason: 'needs sign-in' }]);
  });
});

function answer(bytes: number, headers: Record<string, string>): Answer {
  return { status: 200, ms: 1, body: null, bytes, headers: new Headers(headers), error: null };
}

describe('report', () => {
  const report: Report = {
    startedAt: '2026-10-28T10:00:00.000Z',
    url: 'http://127.0.0.1:38080',
    version: 'fake-1',
    people: 30,
    durationS: 60,
    budgetMs: 1000,
    steps: [{ step: PAGE_OPEN, done: 812, p50: 35, p95: 90, max: 240, failed: 0, errors: 0 }],
    skipped: [{ step: 'search', reason: 'needs POST /api/search/query' }],
    problems: [],
    files: filesSummary([
      { path: '/assets/app.js', answer: answer(300 * 1024, { 'content-encoding': 'br' }) },
      {
        path: '/assets/app.css',
        answer: answer(20 * 1024, { 'cache-control': 'public, max-age=31536000, immutable' }),
      },
    ]),
    verdict: { passed: true, reasons: [], unchecked: [] },
  };

  it('sums up the files of a first visit', () => {
    expect(report.files).toEqual({
      count: 2,
      bytes: 320 * 1024,
      largest: { path: '/assets/app.js', bytes: 300 * 1024 },
      compressed: 1,
      longCache: 1,
    });
    expect(filesSummary([])).toBeNull();
  });

  it('writes the verdict, a table row for each step and what was skipped', () => {
    const text = markdown(report);
    expect(text).toContain('### Load test: 30 people for 60 s');
    expect(text).toContain('**Passed:** page open p95 is 90 ms (budget 1000 ms)');
    expect(text).toContain('| page open | 812 | 35 ms | 90 ms | 240 ms | 0 | 0 |');
    expect(text).toContain('- search: needs POST /api/search/query');
    expect(text).toContain('2 files, 320 KB after decompression');
    const failed = markdown({
      ...report,
      verdict: {
        passed: false,
        reasons: ['2 server errors (5xx, dropped or too slow)'],
        unchecked: [],
      },
      problems: [{ problem: 'search: POST /api/search/query answered 500', count: 2 }],
    });
    expect(failed).toContain('**Failed:** 2 server errors (5xx, dropped or too slow).');
    expect(failed).toContain('- search: POST /api/search/query answered 500 (2 times)');
  });
});
