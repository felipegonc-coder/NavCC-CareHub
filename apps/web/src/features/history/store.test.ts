import { afterEach, describe, expect, it } from 'vitest';
import { closeVersionHistory, currentVersionHistory, openVersionHistory } from './store';

afterEach(() => closeVersionHistory());

describe('the Version history window store', () => {
  it('opens on the newest version, or on the one asked for', () => {
    openVersionHistory({ id: 'page-refund-steps', title: 'Refund steps' });
    expect(currentVersionHistory()).toEqual({
      page: { id: 'page-refund-steps', title: 'Refund steps' },
      versionId: null,
    });
    openVersionHistory({ id: 'page-refund-steps', title: 'Refund steps' }, 'v-2');
    expect(currentVersionHistory()?.versionId).toBe('v-2');
  });

  it('keeps only the page id and title', () => {
    const page = { id: 'page-refund-steps', kind: 'page', title: 'Refund steps' };
    openVersionHistory(page);
    expect(currentVersionHistory()?.page).toEqual({
      id: 'page-refund-steps',
      title: 'Refund steps',
    });
  });

  it('closes', () => {
    openVersionHistory({ id: 'page-refund-steps', title: 'Refund steps' });
    closeVersionHistory();
    expect(currentVersionHistory()).toBeNull();
  });
});
