import {
  importSource,
  problemsCsv,
  type ImportSource,
  type ImportView,
} from '@carehub/extras/import-export/import/index';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { announcement, ImportPanel } from './ImportPanel';
import { createTracker, type ImportTracker } from './tracker';

const A = '0b6f5a52-55f4-4d8e-a8f4-6f2f0f9d3a10';
const B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const SUPPORT = '5d0c1e8a-3f7b-4c2d-9e6a-1b2c3d4e5f60';

const view = (status: ImportView['status'], changes: Partial<ImportView> = {}): ImportView => ({
  id: A,
  source: 'notion',
  fileName: 'notion-export.zip',
  size: 2_400,
  status,
  destination: { pageId: SUPPORT, title: 'Support' },
  progress: null,
  counts: null,
  problems: [],
  problemCount: 0,
  error: null,
  canUndo: false,
  createdAt: '2026-10-27T10:00:00.000Z',
  finishedAt: null,
  ...changes,
});

const running = (done: number, total = 1_204) => view('running', { progress: { done, total } });
const problems = [
  { file: 'Trip/index.html', what: '3 pictures left out', why: "Their files weren't found." },
  { file: 'Budget.csv', what: '1 formula kept as text', why: '=SUM(B2:B9)' },
];
const finished = view('done', {
  counts: { pages: 1_204, databases: 6, rows: 4_310, files: 890 },
  problems,
  problemCount: 3,
  canUndo: true,
  finishedAt: '2026-10-27T10:20:00.000Z',
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const realFetch = globalThis.fetch;
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
const realClick = HTMLAnchorElement.prototype.click;
let tracker: ImportTracker | undefined;
afterEach(() => {
  globalThis.fetch = realFetch;
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
  HTMLAnchorElement.prototype.click = realClick;
  tracker?.stop();
  tracker = undefined;
});

/** Answers by method and path; keeps "METHOD /path" of each request, and each body. */
function serve(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    const method = init?.method ?? 'GET';
    const url = String(input).replace('/api/import-export/imports', '');
    calls.push(`${method} ${url}`);
    bodies.push(init?.body);
    const route = Object.entries(routes).find(([key]) => `${method} ${url}` === key);
    return route ? route[1]() : json(500, {});
  };
  return { calls, bodies };
}

function show(list: ImportView[] = []) {
  tracker = createTracker({ every: 60_000, get: async () => finished, list: async () => list });
  render(
    <MemoryRouter>
      <ImportPanel tracker={tracker} />
    </MemoryRouter>,
  );
  return tracker;
}

const panel = () => screen.getByRole('region', { name: 'Imports' });

describe('the progress panel', () => {
  it('shows progress with Cancel, and can be closed', () => {
    const tracker = show();
    expect(screen.queryByRole('region', { name: 'Imports' })).toBeNull();
    act(() => tracker.follow(running(312)));
    expect(panel()).toHaveTextContent('Importing notion-export.zip · 312 of 1,204 pages');
    const bar = within(panel()).getByRole('progressbar', { name: 'Importing notion-export.zip' });
    expect(bar).toHaveAttribute('aria-valuenow', '312');
    expect(bar).toHaveAttribute('aria-valuemax', '1204');
    expect(within(panel()).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Imports' })).toBeNull();
    expect(tracker.snapshot().imports).toHaveLength(1);
  });

  it('says when an import waits, or its file is still being sent', () => {
    const tracker = show();
    act(() => tracker.follow(view('waiting')));
    expect(panel()).toHaveTextContent('Importing notion-export.zip · waiting to start');
    act(() => tracker.follow(view('uploading', { id: B, fileName: 'Trip.zip' })));
    expect(panel()).toHaveTextContent('Trip.zip is still being sent.');
    expect(within(panel()).getAllByRole('button', { name: 'Cancel' })).toHaveLength(2);
  });

  it('cancels, then lets the person dismiss it', async () => {
    const { calls } = serve({
      [`POST /${A}/cancel`]: () => json(200, { import: view('cancelled') }),
    });
    const tracker = show();
    act(() => tracker.follow(running(10)));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(panel()).toHaveTextContent('The import was cancelled. Nothing was added.'),
    );
    expect(calls).toEqual([`POST /${A}/cancel`]);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: 'Imports' })).toBeNull();
  });

  it('shows how it ended when Cancel came too late', async () => {
    serve({
      [`POST /${A}/cancel`]: () => json(409, { error: { code: 'conflict', message: 'Ended.' } }),
      [`GET /${A}`]: () => json(200, { import: finished }),
    });
    const tracker = show();
    act(() => tracker.follow(running(1_200)));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(panel()).toHaveTextContent('Imported 1,204 pages'));
  });

  it('sums it up, with the problems open, as CSV, Open and Undo import', async () => {
    const tracker = show();
    act(() => tracker.follow(finished));
    expect(panel()).toHaveTextContent(
      'Imported 1,204 pages, 6 databases, 4,310 rows and 890 files into Support.',
    );
    const toggle = within(panel()).getByRole('button', { name: '3 problems' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const [, first, second] = within(panel()).getAllByRole('listitem');
    expect(first).toHaveTextContent(
      "Trip/index.html: 3 pictures left out. Their files weren't found.",
    );
    expect(second).toHaveTextContent('Budget.csv: 1 formula kept as text. =SUM(B2:B9)');
    expect(panel()).toHaveTextContent('The first 2 are listed.');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(panel()).getByText('Budget.csv')).not.toBeVisible();
    fireEvent.click(toggle);

    const made: Blob[] = [];
    const saved: string[] = [];
    URL.createObjectURL = (blob: Blob) => {
      made.push(blob);
      return 'blob:problems';
    };
    const revoked: string[] = [];
    URL.revokeObjectURL = (url: string) => void revoked.push(url);
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      saved.push(`${this.download} ${this.getAttribute('href')}`);
    };
    fireEvent.click(within(panel()).getByRole('button', { name: 'Download as CSV' }));
    expect(saved).toEqual(['notion-export problems.csv blob:problems']);
    expect(revoked).toEqual([]);
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(made[0] as Blob);
    });
    expect(text).toBe(problemsCsv(problems));
    await waitFor(() => expect(revoked).toEqual(['blob:problems']), { timeout: 3_000 });

    expect(within(panel()).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      `/p/${SUPPORT}`,
    );
    expect(within(panel()).getByRole('button', { name: 'Undo import' })).toBeInTheDocument();
  });

  it('leaves Open out for Private, and Undo once it can no longer be undone', () => {
    const tracker = show();
    act(() =>
      tracker.follow({
        ...finished,
        canUndo: false,
        destination: { pageId: null, title: 'Private' },
      }),
    );
    expect(panel()).toHaveTextContent('into Private.');
    expect(within(panel()).queryByRole('link', { name: 'Open' })).toBeNull();
    expect(within(panel()).queryByRole('button', { name: 'Undo import' })).toBeNull();
  });

  it('undoes an import, keeping pages changed since unless they are ticked', async () => {
    const preview = {
      changed: [{ pageId: B, title: 'Shift notes' }],
      unchanged: [{ pageId: SUPPORT, title: 'Handover' }],
    };
    const { calls, bodies } = serve({
      [`GET /${A}/undo`]: () => json(200, { preview }),
      [`POST /${A}/undo`]: () => json(200, { import: view('undone') }),
    });
    const tracker = show();
    act(() => tracker.follow(finished));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Undo import' }));
    const dialog = await screen.findByRole('dialog', { name: 'Undo import?' });
    expect(dialog).toHaveTextContent(
      'Everything notion-export.zip added goes to Trash as one entry.',
    );
    await waitFor(() => expect(within(dialog).getByText('Shift notes')).toBeInTheDocument());
    const tick = within(dialog).getByRole('checkbox', { name: 'Remove them too' });
    expect(tick).not.toBeChecked();
    fireEvent.click(tick);
    expect(tick).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Undo import' }));
    await waitFor(() =>
      expect(panel()).toHaveTextContent('The import was undone. What it added is in Trash.'),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls).toEqual([`GET /${A}/undo`, `POST /${A}/undo`]);
    expect(JSON.parse(String(bodies[1]))).toEqual({ removeChanged: true });
  });

  it('says why an undo failed, in the dialog', async () => {
    serve({
      [`GET /${A}/undo`]: () => json(200, { preview: { changed: [], unchanged: [] } }),
      [`POST /${A}/undo`]: () =>
        json(409, { error: { code: 'conflict', message: 'This import can no longer be undone.' } }),
    });
    const tracker = show();
    act(() => tracker.follow(finished));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Undo import' }));
    const dialog = await screen.findByRole('dialog', { name: 'Undo import?' });
    const undo = within(dialog).getByRole('button', { name: 'Undo import' });
    await waitFor(() => expect(undo).toBeEnabled());
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    fireEvent.click(undo);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This import can no longer be undone.',
    );
  });

  it('says why an import stopped, and starts it again with the same file', async () => {
    const failed = view('failed', {
      error: 'The import stopped: the zip is damaged. Nothing was added.',
    });
    const { calls } = serve({
      'POST ': () => json(201, { import: view('uploading', { id: B }) }),
      [`PUT /${B}/file`]: () => json(200, { import: view('waiting', { id: B }) }),
    });
    const tracker = show();
    const request = {
      source: importSource('markdown') as ImportSource,
      file: new File(['# Trip'], 'Trip.md'),
      pageId: SUPPORT,
    };
    act(() => tracker.follow(failed, request));
    expect(panel()).toHaveTextContent('The import stopped: the zip is damaged. Nothing was added.');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(tracker.snapshot().imports.map((item) => item.id)).toEqual([B]));
    expect(calls).toEqual(['POST ', `PUT /${B}/file`]);
    expect(tracker.request(B)).toBe(request);
  });

  it('sends Try again to the Import screen when this tab no longer has the file', () => {
    const tracker = show();
    act(() => tracker.follow(view('failed', { error: 'The import stopped: it took too long.' })));
    expect(within(panel()).getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      `/import?to=${SUPPORT}`,
    );
  });

  it('announces every 25% and the end, even while closed', () => {
    const tracker = show();
    const status = screen.getByRole('status');
    act(() => tracker.follow(running(0, 8)));
    act(() => tracker.update(running(1, 8)));
    expect(status).toHaveTextContent('');
    act(() => tracker.update(running(2, 8)));
    expect(status).toHaveTextContent('Importing notion-export.zip · 2 of 8 pages');
    act(() => tracker.close());
    act(() => tracker.update(running(3, 8)));
    expect(status).toHaveTextContent('Importing notion-export.zip · 2 of 8 pages');
    act(() => tracker.update(running(6, 8)));
    expect(status).toHaveTextContent('Importing notion-export.zip · 6 of 8 pages');
    act(() => tracker.update(finished));
    expect(status).toHaveTextContent(
      'Import finished. 1,204 pages, 6 databases, 4,310 rows, 890 files, 3 problems.',
    );
  });

  it('after a reload, picks up imports still going, without opening', async () => {
    const tracker = show([running(5), view('done', { id: B })]);
    await waitFor(() => expect(tracker.snapshot().imports).toHaveLength(1));
    expect(screen.queryByRole('region', { name: 'Imports' })).toBeNull();
    act(() => tracker.open());
    expect(panel()).toHaveTextContent('Importing notion-export.zip · 5 of 1,204 pages');
  });
});

describe('what the panel announces', () => {
  it('says each quarter, the end, and why it stopped', () => {
    expect(announcement(running(100))).toBe(null);
    expect(announcement(running(301))).toBe('Importing notion-export.zip · 301 of 1,204 pages');
    expect(announcement(view('waiting'))).toBe(null);
    expect(announcement(finished)).toBe(
      'Import finished. 1,204 pages, 6 databases, 4,310 rows, 890 files, 3 problems.',
    );
    expect(
      announcement(view('failed', { error: 'The import stopped: x. Nothing was added.' })),
    ).toBe('The import stopped: x. Nothing was added.');
    expect(announcement(view('cancelled'))).toBe('Import cancelled. Nothing was added.');
    expect(announcement(view('undone'))).toBe(null);
  });
});
