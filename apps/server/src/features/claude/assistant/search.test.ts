import { describe, expect, it, vi } from 'vitest';

const { runSearch } = vi.hoisted(() => ({ runSearch: vi.fn() }));
vi.mock('../../search', () => ({ runSearch }));

const { careHubSearch } = await import('./ask');

describe('All pages I can open', () => {
  it('runs Care Hub Search as the person, for any of the words, best match first', async () => {
    runSearch.mockResolvedValue({
      results: [{ id: 'page-1', title: 'Refund policy', kind: 'page', snippet: null }],
      total: 1,
      nextCursor: null,
    });
    const db = {} as Parameters<typeof careHubSearch>[0];
    const asker = { workspaceId: 'workspace-1', userId: 'avery' };
    expect(await careHubSearch(db, asker, ['refunds', 'QA-17'])).toEqual([
      { id: 'page-1', title: 'Refund policy' },
    ]);
    expect(runSearch).toHaveBeenCalledWith(db, asker, {
      text: 'refunds QA-17',
      match: 'any',
      sort: 'best',
      limit: 10,
      filters: { types: ['page', 'database', 'row'] },
    });
  });
});
