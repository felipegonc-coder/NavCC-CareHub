import type { SearchResult } from '@carehub/extras/search';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

type Call = { method: string; url: string; body: unknown };

/** A fake search API on fetch: results by the text searched for. */
function serve(options: { found?: SearchResult[]; status?: number } = {}) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const method = init?.method ?? 'GET';
    const url = String(input);
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    if (url === '/api/search/query') {
      if (options.status)
        return json(options.status, { error: { code: 'unexpected', message: 'No.' } });
      const { text } = body as { text: string };
      const results = (options.found ?? []).filter((found) =>
        found.title.toLowerCase().includes(text.trim().toLowerCase()),
      );
      return json(200, { results, total: results.length, nextCursor: null });
    }
    return new Response(null, { status: 204 });
  });
  return calls;
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
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
    expect(dialog.getByText('Type to search pages, databases and rows.')).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(before).toHaveFocus());
  });

  it('searches while typing, moves with the arrows and opens with Enter (SR-03)', async () => {
    serve({ found: [refund, policy] });
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
  });

  it('says when nothing is found (SR-11)', async () => {
    serve({ found: [refund] });
    show();
    const { dialog, box } = await openWindow();
    fireEvent.change(box, { target: { value: 'qzxv' } });
    expect(
      await dialog.findByText('No results for ‘qzxv’.', { selector: 'p' }),
    ).toBeInTheDocument();
    fireEvent.keyDown(box, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
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
