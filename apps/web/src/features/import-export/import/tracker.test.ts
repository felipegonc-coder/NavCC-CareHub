import type { ImportView } from '@carehub/extras/import-export/import/index';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../../lib/api';
import { createTracker, isGoing, type ImportTracker } from './tracker';

const view = (id: string, status: ImportView['status'], done = 0): ImportView => ({
  id,
  source: 'markdown',
  fileName: 'Trip.zip',
  size: 2_400,
  status,
  destination: { pageId: null, title: 'Private' },
  progress: status === 'running' ? { done, total: 8 } : null,
  counts: status === 'done' ? { pages: 8, databases: 0, rows: 0, files: 2 } : null,
  problems: [],
  problemCount: 0,
  error: null,
  canUndo: status === 'done',
  createdAt: '2026-10-27T10:00:00.000Z',
  finishedAt: status === 'done' ? '2026-10-27T10:01:00.000Z' : null,
});

const A = '0b6f5a52-55f4-4d8e-a8f4-6f2f0f9d3a10';
const B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const C = '3f2b8c1d-6e4a-4b9f-8d7c-2a1e0f9b8c7d';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let tracker: ImportTracker | undefined;
afterEach(() => {
  tracker?.stop();
  tracker = undefined;
});

/** A tracker whose checks wait until the test answers them, one at a time. */
function tracked(every = 1) {
  const asked: string[] = [];
  const waiting: ((answer: ImportView | Error) => void)[] = [];
  tracker = createTracker({
    every,
    get: (id) =>
      new Promise<ImportView>((resolve, reject) => {
        asked.push(id);
        waiting.push((answer) => (answer instanceof Error ? reject(answer) : resolve(answer)));
      }),
    list: async () => [view(B, 'running', 2), view(C, 'done'), view(A, 'waiting')],
  });
  /** Waits for the next check, answers it, and lets the tracker take the answer in. */
  async function answer(next: ImportView | Error) {
    for (let tries = 0; waiting.length === 0; tries += 1) {
      if (tries > 200) throw new Error('No check came.');
      await sleep(2);
    }
    waiting.shift()?.(next);
    await sleep(0);
  }
  return { tracker, asked, answer, checking: () => waiting.length > 0 };
}

describe('following imports', () => {
  it('knows which imports are still going', () => {
    const statuses = ['uploading', 'waiting', 'running', 'done', 'failed', 'cancelled', 'undone'];
    expect(statuses.map((status) => isGoing(view(A, status as ImportView['status'])))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('opens the panel and checks on an import until it ends', async () => {
    const { tracker, asked, answer, checking } = tracked();
    let changes = 0;
    tracker.subscribe(() => (changes += 1));
    tracker.follow(view(A, 'waiting'));
    expect(tracker.snapshot()).toEqual({ imports: [view(A, 'waiting')], open: true });
    await answer(view(A, 'running', 3));
    expect(tracker.snapshot().imports).toEqual([view(A, 'running', 3)]);
    await answer(view(A, 'done'));
    expect(tracker.snapshot().imports).toEqual([view(A, 'done')]);
    await sleep(20);
    expect(checking()).toBe(false);
    expect(asked).toEqual([A, A]);
    expect(changes).toBe(3);
  });

  it('keeps the newest first, and takes finished ones out', () => {
    const { tracker } = tracked(60_000);
    tracker.follow(view(A, 'waiting'));
    tracker.follow(view(B, 'waiting'));
    expect(tracker.snapshot().imports.map((item) => item.id)).toEqual([B, A]);
    tracker.update(view(A, 'cancelled'));
    expect(tracker.snapshot().imports.map((item) => item.status)).toEqual(['waiting', 'cancelled']);
    tracker.dismiss(A);
    tracker.dismiss(B);
    expect(tracker.snapshot()).toEqual({ imports: [], open: false });
    // Only followed imports are updated.
    tracker.update(view(A, 'done'));
    expect(tracker.snapshot().imports).toEqual([]);
  });

  it('can be closed, and opens again when an import ends', async () => {
    const { tracker, answer } = tracked();
    tracker.follow(view(A, 'waiting'));
    tracker.close();
    await answer(view(A, 'running', 4));
    expect(tracker.snapshot().open).toBe(false);
    await answer(view(A, 'failed'));
    expect(tracker.snapshot()).toEqual({ imports: [view(A, 'failed')], open: true });
    tracker.close();
    tracker.open();
    expect(tracker.snapshot().open).toBe(true);
  });

  it('drops an answer that a newer change overtook', async () => {
    const { tracker, answer, checking } = tracked();
    tracker.follow(view(A, 'running', 1));
    for (let tries = 0; !checking() && tries < 200; tries += 1) await sleep(2);
    // Cancel answered while the check was on its way.
    tracker.update(view(A, 'cancelled'));
    await answer(view(A, 'running', 5));
    expect(tracker.snapshot().imports).toEqual([view(A, 'cancelled')]);
    await sleep(20);
    expect(checking()).toBe(false);
  });

  it('lets go of an import that is gone, and keeps checking when offline', async () => {
    const gone = tracked();
    gone.tracker.follow(view(A, 'waiting'));
    await gone.answer(new ApiError(404, 'not_found', 'Not found.'));
    expect(gone.tracker.snapshot()).toEqual({ imports: [], open: false });
    gone.tracker.stop();

    const offline = tracked();
    offline.tracker.follow(view(B, 'waiting'));
    await offline.answer(new ApiError(0, 'offline', "Can't reach Care Hub."));
    expect(offline.tracker.snapshot().imports).toEqual([view(B, 'waiting')]);
    await offline.answer(view(B, 'done'));
    expect(offline.tracker.snapshot().imports).toEqual([view(B, 'done')]);
  });

  it('after a reload, follows the imports still going without opening the panel', async () => {
    const { tracker } = tracked(60_000);
    await tracker.resume();
    expect(tracker.snapshot()).toEqual({
      imports: [view(B, 'running', 2), view(A, 'waiting')],
      open: false,
    });
    await tracker.resume();
    expect(tracker.snapshot().imports).toHaveLength(2);
    tracker.open();
    expect(tracker.snapshot().open).toBe(true);
  });
});
