import type { SearchRecentResponse, SearchResult } from '@carehub/extras/search';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { closeSearch } from './open';
import { SearchOverlay } from './SearchOverlay';

const result = (id: string, title: string, change: Partial<SearchResult> = {}): SearchResult => ({
  id,
  kind: 'page',
  title,
  titleRanges: [],
  icon: null,
  path: ['Support'],
  snippet: null,
  createdAt: '2026-10-01T12:00:00.000Z',
  editedAt: '2026-10-20T12:00:00.000Z',
  editedBy: { id: 'u1', name: 'Sam Ortiz' },
  rowIn: null,
  verified: false,
  archived: false,
  ...change,
});

const PAGE_A = '00000000-0000-4000-8000-00000000000a';
const PAGE_B = '00000000-0000-4000-8000-00000000000b';
const refund = result(PAGE_A, 'Refund steps', {
  titleRanges: [[0, 6]],
  snippet: { text: 'Ask for the refund number.', ranges: [[12, 18]] },
});
const policy = result(PAGE_B, 'Refund policy', { kind: 'database' });

type Call = { method: string; url: string; body: { text?: string } | undefined };

/** A fake search API on fetch: the recent lists, and results by the text searched for. */
function serve(
  options: {
    recent?: SearchRecentResponse;
    found?: SearchResult[];
    /** Did you mean, by the text searched for. */
    suggest?: Record<string, string>;
    status?: number;
  } = {},
) {
  const calls: Call[] = [];
  const recent = options.recent ?? { pages: [], searches: [] };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const method = init?.method ?? 'GET';
    const url = String(input);
    const body: Call['body'] = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    if (url === '/api/search/recent' && method === 'GET') return json(200, recent);
    if (url === '/api/search/query') {
      if (options.status)
        return json(options.status, { error: { code: 'unexpected', message: 'No.' } });
      const { text } = body as { text: string };
      const results = (options.found ?? []).filter((found) =>
        found.title.toLowerCase().includes(text.trim().toLowerCase()),
      );
      const didYouMean = options.suggest?.[text.trim()];
      return json(200, { results, total: results.length, nextCursor: null, didYouMean });
    }
    return new Response(null, { status: 204 });
  });
  return calls;
}

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <button type="button">Before</button>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <SearchOverlay />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const press = (
  key: string,
  change: Partial<KeyboardEventInit> = {},
  target: Element | Window = window,
) => fireEvent.keyDown(target, { key, code: `Key${key.toUpperCase()}`, ctrlKey: true, ...change });

async function openWindow(key = 'k') {
  press(key);
  // The window's code loads on first use.
  const dialog = await screen.findByRole('dialog', { name: 'Search' }, { timeout: 5000 });
  const box = within(dialog).getByRole('combobox', { name: 'Search' });
  await waitFor(() => expect(box).toHaveFocus());
  return { dialog: within(dialog), box };
}

// jsdom has no ResizeObserver; the chips' menus measure themselves.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  window.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  closeSearch();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the search window', () => {
  it('opens with Ctrl+K and Ctrl+P, unless the editor has used the key (SR-01)', async () => {
    serve();
    show();
    await openWindow('k');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await openWindow('p');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const editor = screen.getByRole('button', { name: 'Before' });
    editor.addEventListener('keydown', (event) => event.preventDefault());
    press('k', {}, editor);
    press('j');
    await new Promise((done) => setTimeout(done, 50));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('puts the focus back where it was when Esc closes it', async () => {
    serve();
    show();
    const before = screen.getByRole('button', { name: 'Before' });
    before.focus();
    const { dialog } = await openWindow();
    expect(
      await dialog.findByText('Type to search pages, databases and rows.'),
    ).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(before).toHaveFocus());
  });

  it('shows the recent pages and searches before typing; Clear empties the searches (SR-02)', async () => {
    const calls = serve({
      recent: {
        pages: [refund, policy],
        searches: [
          { id: 's1', text: 'refund', filters: {}, searchedAt: '2026-10-26T15:00:00.000Z' },
          { id: 's2', text: 'pay bands', filters: {}, searchedAt: '2026-10-25T15:00:00.000Z' },
        ],
      },
    });
    show();
    const { dialog, box } = await openWindow();
    const pages = within(await dialog.findByRole('group', { name: 'Recent' }));
    expect(pages.getAllByRole('option').map((option) => option.getAttribute('aria-label'))).toEqual(
      [
        'Refund steps, page in Support, edited Oct 20',
        'Refund policy, database in Support, edited Oct 20',
      ],
    );
    expect(pages.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    const searches = within(dialog.getByRole('group', { name: 'Recent searches' }));
    expect(searches.getAllByRole('option')).toHaveLength(2);

    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(searches.getByRole('option', { name: 'refund' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.keyDown(box, { key: 'Delete' });
    await waitFor(() =>
      expect(searches.queryByRole('option', { name: 'refund' })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'DELETE',
        url: '/api/search/recent/s1',
        body: undefined,
      }),
    );

    fireEvent.click(searches.getByRole('button', { name: 'Clear' }));
    await waitFor(() =>
      expect(dialog.queryByRole('group', { name: 'Recent searches' })).not.toBeInTheDocument(),
    );
    expect(calls).toContainEqual({ method: 'DELETE', url: '/api/search/recent', body: undefined });
    expect(dialog.getByRole('group', { name: 'Recent' })).toBeInTheDocument();
  });

  it('searches while typing, moves with the arrows and opens with Enter (SR-03)', async () => {
    const calls = serve({ found: [refund, policy] });
    show();
    const { dialog, box } = await openWindow();
    fireEvent.change(box, { target: { value: 'ref' } });
    const first = await dialog.findByRole('option', { name: /^Refund steps/ });
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(box).toHaveAttribute('aria-activedescendant', first.id);
    expect(dialog.getByRole('status')).toHaveTextContent('2 results');
    expect(within(first).getByText('Refund', { selector: 'strong' })).toBeInTheDocument();
    expect(within(first).getByText('refund', { selector: 'mark' })).toBeInTheDocument();
    expect(within(first).getByText('Edited Oct 20 by Sam Ortiz')).toBeInTheDocument();
    expect(dialog.getByRole('option', { name: /^Refund policy/ })).toHaveTextContent('Database');

    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(dialog.getByRole('option', { name: /^Refund policy/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/p/${PAGE_B}`));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls).toContainEqual({
      method: 'POST',
      url: '/api/search/history',
      body: { text: 'ref', save: true, found: 2, opened: PAGE_B },
    });
  });

  it('offers Did you mean and Search in Trash when nothing is found (SR-11)', async () => {
    const calls = serve({ found: [refund], suggest: { refnd: 'refund' } });
    const history = (text: string) =>
      calls.filter((call) => call.url === '/api/search/history' && call.body?.text === text);
    show();
    let { dialog, box } = await openWindow();
    fireEvent.change(box, { target: { value: 'refnd' } });
    expect(
      await dialog.findByText('No results for ‘refnd’.', { selector: 'p' }),
    ).toBeInTheDocument();
    expect(dialog.getByText(/Did you mean/)).toHaveTextContent('Did you mean refund?');
    fireEvent.click(dialog.getByRole('button', { name: 'refund' }));
    expect(box).toHaveValue('refund');
    expect(box).toHaveFocus();
    expect(await dialog.findByRole('option', { name: /^Refund steps/ })).toBeInTheDocument();
    // Closing counts the search without saving it (spec 3.4).
    fireEvent.keyDown(box, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(history('refund').map((call) => call.body)).toEqual([
      { text: 'refund', save: false, found: 1 },
    ]);

    ({ dialog, box } = await openWindow());
    fireEvent.change(box, { target: { value: 'qzxv' } });
    await dialog.findByText('No results for ‘qzxv’.', { selector: 'p' });
    expect(dialog.queryByText(/Did you mean/)).not.toBeInTheDocument();
    // Enter saves it to Recent searches and leaves the window open.
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(dialog.getByRole('button', { name: 'Search in Trash' })).toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Search in Trash' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/trash?q=qzxv'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(history('qzxv').map((call) => call.body)).toEqual([
      { text: 'qzxv', save: true, found: 0 },
    ]);
  });

  it('filters with the chips and sorts; Clear filters turns them all off (SR-06)', async () => {
    const calls = serve({ found: [refund, policy] });
    const searched = () =>
      calls.filter((call) => call.url === '/api/search/query').map((call) => call.body);
    show();
    const { dialog, box } = await openWindow();
    fireEvent.change(box, { target: { value: 'ref' } });
    await dialog.findByRole('option', { name: /^Refund steps/ });
    expect(dialog.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();

    fireEvent.click(dialog.getByRole('button', { name: 'Title only' }));
    expect(dialog.getByRole('button', { name: 'Title only' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.keyDown(dialog.getByRole('button', { name: 'Type' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Databases' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(await dialog.findByRole('button', { name: 'Type: Databases' })).toBeInTheDocument();
    fireEvent.keyDown(dialog.getByRole('button', { name: 'Sort: Best match' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Edited, newest first' }));
    await waitFor(() =>
      expect(searched()).toContainEqual({
        text: 'ref',
        filters: { titleOnly: true, types: ['database'] },
        sort: 'edited_desc',
      }),
    );

    fireEvent.click(await dialog.findByRole('button', { name: 'Clear filters' }));
    expect(box).toHaveFocus();
    expect(dialog.getByRole('button', { name: 'Title only' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(dialog.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Sort: Edited, newest first' })).toBeInTheDocument();
    await waitFor(() =>
      expect(searched().at(-1)).toEqual({ text: 'ref', filters: {}, sort: 'edited_desc' }),
    );
  });

  it('saves the filters with the search, and a recent search brings them back', async () => {
    const calls = serve({
      found: [refund],
      recent: {
        pages: [],
        searches: [
          {
            id: 's1',
            text: 'refund',
            filters: { titleOnly: true },
            searchedAt: '2026-10-26T15:00:00.000Z',
          },
        ],
      },
    });
    show();
    const { dialog, box } = await openWindow();
    fireEvent.click(await dialog.findByRole('option', { name: 'refund' }));
    expect(box).toHaveValue('refund');
    expect(box).toHaveFocus();
    expect(dialog.getByRole('button', { name: 'Title only' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await dialog.findByRole('option', { name: /^Refund steps/ });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/p/${PAGE_A}`));
    expect(calls).toContainEqual({
      method: 'POST',
      url: '/api/search/history',
      body: { text: 'refund', filters: { titleOnly: true }, save: true, found: 1, opened: PAGE_A },
    });
  });

  it('offers Try again when search fails', async () => {
    const calls = serve({ status: 500 });
    show();
    const { dialog, box } = await openWindow();
    fireEvent.change(box, { target: { value: 'refund' } });
    fireEvent.click(await dialog.findByRole('button', { name: 'Try again' }));
    expect(dialog.getByText("Search isn't working right now.")).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.filter((call) => call.url === '/api/search/query')).toHaveLength(2),
    );
  });
});
