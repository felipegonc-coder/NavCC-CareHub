import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { HistoryPageWatcher, isHistoryShortcut, type WatchedPage } from './HistoryPageWatcher';
import { closeVersionHistory, currentVersionHistory } from './store';
import { PAGE } from './testServer';

function Search() {
  return <output aria-label="Search">{useLocation().search}</output>;
}

function renderWatcher(page: WatchedPage, url = `/p/${page.id}`) {
  return render(
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
    </MemoryRouter>,
  );
}

const keys = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: 'KeyH' };

afterEach(() => closeVersionHistory());

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
});
