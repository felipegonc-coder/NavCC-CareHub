import { restoreNote, versionDate } from '@carehub/extras/history';
import { ToastProvider } from '@carehub/ui';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLiveClientForTest } from '../live/client';
import { createFakeLive, flush } from '../live/testSource';
import { HistoryPageWatcher, isHistoryShortcut, type WatchedPage } from './HistoryPageWatcher';
import { closeVersionHistory, currentVersionHistory, runRestore } from './store';
import { AVERY, fakeHistoryServer, fakeVersion, PAGE, PAGE_ID, SAM } from './testServer';

const realFetch = globalThis.fetch;
let live: ReturnType<typeof createFakeLive>;

function Search() {
  return <output aria-label="Search">{useLocation().search}</output>;
}

function renderWatcher(page: WatchedPage, url = `/p/${page.id}`) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/p/:pageId"
            element={
              <>
                <HistoryPageWatcher page={page} />
                <Search />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

/** A restore by `by`: the server saved `savedId` just before putting back the version `from`. */
function serveRestore(savedId: string, by = SAM) {
  const restored = fakeVersion('v-1', 50 * 60, 'Use the old fax line.');
  const saved = fakeVersion(savedId, 0, 'Call the member today.', {
    kind: 'before_restore',
    editors: [],
    createdBy: by,
    restoredFrom: restored.summary.createdAt,
  });
  const server = fakeHistoryServer([saved, restored]);
  globalThis.fetch = server.fetch;
  return { server, from: versionDate(restored.summary.createdAt) };
}

const sendRestored = (versionId: string) =>
  act(async () => {
    live.send(
      { type: 'history.restored', data: { pageId: PAGE_ID, versionId } },
      `history:${PAGE_ID}`,
    );
    await flush();
  });

/** Dates and times can hold narrow spaces; the text matchers see plain ones. */
const plain = (value: string) => value.replace(/\s+/g, ' ');

const keys = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: 'KeyH' };

beforeEach(() => {
  live = createFakeLive();
  setLiveClientForTest(live.client);
});

afterEach(() => {
  closeVersionHistory();
  globalThis.fetch = realFetch;
  setLiveClientForTest(null);
});

describe('the history page watcher', () => {
  it('opens a ?version= link on that version and tidies the address', () => {
    renderWatcher(PAGE, `/p/${PAGE.id}?version=v-2&view=full`);
    expect(currentVersionHistory()).toEqual({
      page: { id: PAGE.id, title: 'Refund steps' },
      versionId: 'v-2',
    });
    expect(screen.getByRole('status', { name: 'Search' })).toHaveTextContent('?view=full');
  });

  it('opens Version history with Ctrl+Alt+H', () => {
    renderWatcher(PAGE);
    fireEvent.keyDown(window, { key: 'h', code: 'KeyH', ctrlKey: true });
    expect(currentVersionHistory()).toBeNull();

    fireEvent.keyDown(window, { key: '˙', code: 'KeyH', ctrlKey: true, altKey: true });
    expect(currentVersionHistory()).toEqual({
      page: { id: PAGE.id, title: 'Refund steps' },
      versionId: null,
    });
  });

  it('does nothing on databases', () => {
    renderWatcher({ ...PAGE, kind: 'database' }, `/p/${PAGE.id}?version=v-2`);
    fireEvent.keyDown(window, { code: 'KeyH', ctrlKey: true, altKey: true });
    expect(currentVersionHistory()).toBeNull();
  });

  it('knows the shortcut by key position', () => {
    expect(isHistoryShortcut({ ...keys, ctrlKey: true, altKey: true })).toBe(true);
    expect(isHistoryShortcut({ ...keys, ctrlKey: true, altKey: true, shiftKey: true })).toBe(false);
    expect(isHistoryShortcut({ ...keys, ctrlKey: true, altKey: true, code: 'KeyG' })).toBe(false);
    expect(isHistoryShortcut({ ...keys, altKey: true })).toBe(false);
  });

  it('HT-05: shows the note when someone else restores a version', async () => {
    const { from } = serveRestore('v-saved-by-sam');
    renderWatcher(PAGE);
    await act(() => live.open());
    expect(live.subscribed.has(`history:${PAGE_ID}`)).toBe(true);

    await sendRestored('v-saved-by-sam');
    expect(await screen.findByText(plain(restoreNote('Sam Ortiz', from)))).toBeInTheDocument();
  });

  it("skips the note for this tab's own restore, even when the event comes first", async () => {
    const { server } = serveRestore('v-saved-here', AVERY);
    renderWatcher(PAGE);
    await act(() => live.open());

    type Saved = { version: { id: string } };
    let answer: (value: Saved) => void = () => undefined;
    const restore = runRestore(
      PAGE_ID,
      () =>
        new Promise<Saved>((resolve) => {
          answer = resolve;
        }),
    );
    await sendRestored('v-saved-here');
    await act(async () => {
      answer({ version: { id: 'v-saved-here' } });
      await restore;
      await flush();
    });
    expect(screen.queryByText(/restored a version/)).not.toBeInTheDocument();
    expect(server.requests).toEqual([]);
  });
});
