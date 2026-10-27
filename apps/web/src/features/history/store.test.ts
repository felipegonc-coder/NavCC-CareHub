import { afterEach, describe, expect, it } from 'vitest';
import {
  closeVersionHistory,
  currentVersionHistory,
  isOwnRestore,
  openVersionHistory,
  runRestore,
} from './store';

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

describe("this tab's restores", () => {
  type Saved = { version: { id: string } };

  it('remembers the version each restore saved', async () => {
    const answer = await runRestore('page-a', async () => ({ version: { id: 'v-saved-a' } }));
    expect(answer.version.id).toBe('v-saved-a');
    expect(await isOwnRestore('page-a', 'v-saved-a')).toBe(true);
    expect(await isOwnRestore('page-a', 'v-someone-else')).toBe(false);
  });

  it('waits for a restore that is still running', async () => {
    let answer: (value: Saved) => void = () => undefined;
    const restore = runRestore(
      'page-b',
      () =>
        new Promise<Saved>((resolve) => {
          answer = resolve;
        }),
    );
    const own = isOwnRestore('page-b', 'v-saved-b');
    answer({ version: { id: 'v-saved-b' } });
    await restore;
    expect(await own).toBe(true);
  });

  it('answers no after a restore that failed', async () => {
    const restore = runRestore<Saved>('page-c', () => Promise.reject(new Error('Locked')));
    const own = isOwnRestore('page-c', 'v-saved-c');
    await expect(restore).rejects.toThrow('Locked');
    expect(await own).toBe(false);
  });
});
