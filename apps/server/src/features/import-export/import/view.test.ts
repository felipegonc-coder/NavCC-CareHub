import { describe, expect, it } from 'vitest';
import type { ImportRow } from './store';
import { canUndo, importView } from './view';

const finishedAt = new Date('2026-10-20T15:01:00.000Z');
const daysLater = (days: number) => new Date(finishedAt.getTime() + days * 24 * 60 * 60 * 1000);

const row = (change: Partial<ImportRow> = {}): ImportRow => ({
  id: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  userId: '00000000-0000-4000-8000-000000000003',
  source: 'markdown',
  fileName: 'handbook.zip',
  fileSize: 52_000,
  pageId: '00000000-0000-4000-8000-000000000004',
  spaceId: null,
  planned: false,
  status: 'done',
  jobId: 'job-1',
  counts: { pages: 3, databases: 0, rows: 0, files: 2 },
  problems: [{ file: 'map.png', what: 'Skipped', why: "It isn't in the zip." }],
  problemCount: 1,
  error: null,
  createdAt: new Date('2026-10-20T15:00:00.000Z'),
  startedAt: new Date('2026-10-20T15:00:02.000Z'),
  finishedAt,
  undoneAt: null,
  ...change,
});

describe('canUndo', () => {
  it('is there for 7 days after the import is done', () => {
    expect(canUndo(row(), daysLater(6.9))).toBe(true);
    expect(canUndo(row(), daysLater(7))).toBe(false);
    expect(canUndo(row({ status: 'undone' }), daysLater(1))).toBe(false);
    expect(canUndo(row({ status: 'failed' }), daysLater(1))).toBe(false);
    expect(canUndo(row({ finishedAt: null }), daysLater(1))).toBe(false);
  });
});

describe('importView', () => {
  it('shows a done import with where it went and its problems', () => {
    const view = importView(row(), {
      title: 'Care team',
      progress: { done: 3, total: 3 },
      now: daysLater(1),
    });
    expect(view).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      source: 'markdown',
      fileName: 'handbook.zip',
      size: 52_000,
      status: 'done',
      destination: { pageId: '00000000-0000-4000-8000-000000000004', title: 'Care team' },
      progress: null,
      counts: { pages: 3, databases: 0, rows: 0, files: 2 },
      problems: [{ file: 'map.png', what: 'Skipped', why: "It isn't in the zip." }],
      problemCount: 1,
      error: null,
      canUndo: true,
      createdAt: '2026-10-20T15:00:00.000Z',
      finishedAt: '2026-10-20T15:01:00.000Z',
    });
  });

  it('shows progress only while running, and lists leave out the problems', () => {
    const running = row({ status: 'running', counts: null, finishedAt: null, pageId: null });
    const view = importView(running, {
      title: 'Private',
      progress: { done: 1, total: 3 },
      problems: false,
    });
    expect(view).toMatchObject({
      status: 'running',
      destination: { pageId: null, title: 'Private' },
      progress: { done: 1, total: 3 },
      counts: null,
      problems: [],
      problemCount: 1,
      canUndo: false,
      finishedAt: null,
    });
  });
});
