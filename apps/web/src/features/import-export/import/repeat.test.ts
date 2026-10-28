import type { ImportView } from '@carehub/extras/import-export/import/index';
import { describe, expect, it } from 'vitest';
import { dayWords, earlierImport, earlierWords } from './repeat';

const view = (changes: Partial<ImportView>): ImportView => ({
  id: '0b6f5a52-55f4-4d8e-a8f4-6f2f0f9d3a10',
  source: 'notion',
  fileName: 'notion-export.zip',
  size: 2_400,
  status: 'done',
  destination: { pageId: '5d0c1e8a-3f7b-4c2d-9e6a-1b2c3d4e5f60', title: 'Support' },
  progress: null,
  counts: { pages: 12, databases: 1, rows: 30, files: 4 },
  problems: [],
  problemCount: 0,
  error: null,
  canUndo: true,
  createdAt: new Date(2026, 9, 26, 16, 0).toISOString(),
  finishedAt: new Date(2026, 9, 26, 16, 5).toISOString(),
  ...changes,
});

describe('importing the same file again', () => {
  it("says when, in the person's own days", () => {
    const now = new Date(2026, 9, 27, 9, 30);
    expect(dayWords(new Date(2026, 9, 27, 0, 10).toISOString(), now)).toBe('today');
    expect(dayWords(new Date(2026, 9, 26, 23, 50).toISOString(), now)).toBe('yesterday');
    expect(dayWords(new Date(2026, 9, 25, 12, 0).toISOString(), now)).toBe('on Oct 25');
    expect(dayWords(new Date(2026, 9, 27, 11, 0).toISOString(), now)).toBe('today');
  });

  it('finds the latest finished import of the same file into the same place', () => {
    const same = {
      fileName: 'notion-export.zip',
      size: 2_400,
      pageId: view({}).destination.pageId,
    };
    const newer = view({ id: '7c9e6679-7425-40de-944b-e07fc1f90ae7' });
    expect(earlierImport([newer, view({})], same)).toBe(newer);
    expect(earlierImport([view({ status: 'undone' }), view({ status: 'failed' })], same)).toBe(
      undefined,
    );
    expect(earlierImport([view({})], { ...same, size: 2_401 })).toBe(undefined);
    expect(earlierImport([view({})], { ...same, fileName: 'other.zip' })).toBe(undefined);
    expect(earlierImport([view({})], { ...same, pageId: null })).toBe(undefined);
    const private_ = view({ destination: { pageId: null, title: 'Private' } });
    expect(earlierImport([private_], { ...same, pageId: null })).toBe(private_);
  });

  it("puts it in the spec's words", () => {
    expect(earlierWords(view({}), new Date(2026, 9, 27, 9, 30))).toBe(
      'You imported notion-export.zip into Support yesterday.',
    );
    expect(earlierWords(view({ finishedAt: null }), new Date(2026, 9, 26, 18, 0))).toBe(
      'You imported notion-export.zip into Support today.',
    );
  });
});
