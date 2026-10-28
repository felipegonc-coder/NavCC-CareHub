import { IMPORT_SOURCES, type ImportView } from '@carehub/extras/import-export/import/index';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { endingsWords, sizeWords } from './FileDrop';
import { ImportScreen } from './ImportScreen';
import { createTracker, type ImportTracker } from './tracker';

const SUPPORT = '5d0c1e8a-3f7b-4c2d-9e6a-1b2c3d4e5f60';
const ID = '0b6f5a52-55f4-4d8e-a8f4-6f2f0f9d3a10';

const view = (status: ImportView['status'], changes: Partial<ImportView> = {}): ImportView => ({
  id: ID,
  source: 'markdown',
  fileName: 'Trip.md',
  size: 6,
  status,
  destination: { pageId: null, title: 'Private' },
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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const realFetch = globalThis.fetch;
const realMatchMedia = window.matchMedia;
let tracker: ImportTracker | undefined;
afterEach(() => {
  globalThis.fetch = realFetch;
  window.matchMedia = realMatchMedia;
  tracker?.stop();
  tracker = undefined;
});

/** Answers by method and path end; keeps "METHOD /path" of each request, and each body. */
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

const started = {
  'GET ': () => json(200, { imports: [] }),
  'POST ': () => json(201, { import: view('uploading') }),
  [`PUT /${ID}/file`]: () => json(200, { import: view('waiting') }),
};

function show(entry: string | { pathname: string; search: string; state?: unknown } = '/import') {
  tracker = createTracker({ every: 60_000, get: async () => view('waiting') });
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ImportScreen tracker={tracker} />
    </MemoryRouter>,
  );
  return tracker;
}

const sources = () => within(screen.getByRole('group', { name: 'Import from' }));
const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]');

function pick(name: string, content = '# Trip') {
  const input = fileInput();
  if (!input) throw new Error('No file input.');
  fireEvent.change(input, { target: { files: [new File([content], name)] } });
}

describe('the Import screen', () => {
  it('is one titled page with every source and how to get its file', () => {
    show();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Import' })).toBeInTheDocument();
    expect(document.title).toBe('Care Hub · Import');
    const buttons = sources().getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(
      IMPORT_SOURCES.map((source) => `${source.label}${source.howTo}`),
    );
    const notion = sources().getByRole('button', { name: 'Notion export' });
    expect(notion).toHaveAttribute('aria-pressed', 'false');
    expect(
      document.getElementById(notion.getAttribute('aria-describedby') ?? ''),
    ).toHaveTextContent('In Notion, choose Export on a page or in Settings');
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
    expect(screen.queryByText('Big imports are best done on a computer.')).toBeNull();
  });

  it('moves between sources with the arrow keys, one Tab stop for them all', () => {
    show();
    const buttons = sources().getAllByRole('button');
    expect(buttons.map((button) => button.tabIndex)).toEqual(buttons.map((_, i) => (i ? -1 : 0)));
    buttons[0]?.focus();
    fireEvent.keyDown(buttons[0] as HTMLElement, { key: 'ArrowRight' });
    expect(buttons[1]).toHaveFocus();
    fireEvent.keyDown(buttons[1] as HTMLElement, { key: 'End' });
    expect(buttons.at(-1)).toHaveFocus();
    fireEvent.keyDown(buttons.at(-1) as HTMLElement, { key: 'ArrowDown' });
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(buttons[0] as HTMLElement, { key: 'ArrowLeft' });
    expect(buttons.at(-1)).toHaveFocus();
    fireEvent.keyDown(buttons.at(-1) as HTMLElement, { key: 'Home' });
    expect(buttons[0]).toHaveFocus();
    expect(buttons.map((button) => button.tabIndex)).toEqual(buttons.map((_, i) => (i ? -1 : 0)));
  });

  it('asks for the file once a source is chosen, and checks it against the source', () => {
    show();
    fireEvent.click(sources().getByRole('button', { name: 'HTML' }));
    expect(sources().getByRole('button', { name: 'HTML' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'HTML' })).toBeInTheDocument();
    expect(fileInput()).toHaveAttribute('accept', '.html,.htm,.zip');
    expect(screen.getByText('.html, .htm or .zip')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();

    let opened = 0;
    fileInput()?.addEventListener('click', (event) => {
      opened += 1;
      event.preventDefault();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose a file' }));
    expect(opened).toBe(1);

    pick('Trip.md');
    expect(screen.getByRole('alert')).toHaveTextContent('Pick an .html or .zip file.');
    expect(screen.getByRole('button', { name: 'Choose another file' })).toHaveAttribute(
      'aria-describedby',
      screen.getByRole('alert').id,
    );
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    pick('Trip.html', '<p>Trip</p>');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Trip.html')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
    pick('Empty.html', '');
    expect(screen.getByRole('alert')).toHaveTextContent('The file is empty.');
  });

  it('takes a dropped file', () => {
    show();
    fireEvent.click(sources().getByRole('button', { name: 'Text and Markdown' }));
    const area = screen.getByText('Drop the file here').parentElement as HTMLElement;
    const file = new File(['# Trip'], 'Trip.md');
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' };
    fireEvent.dragOver(area, { dataTransfer });
    expect(area.className).toContain('border-primary');
    fireEvent.drop(area, { dataTransfer });
    expect(area.className).not.toContain('border-primary');
    expect(screen.getByText('Trip.md')).toBeInTheDocument();
    expect(screen.getByText('· 6 bytes')).toBeInTheDocument();
  });

  it('starts the import into Private and follows it', async () => {
    const { calls, bodies } = serve(started);
    const tracker = show();
    expect(screen.queryByRole('group', { name: 'Add to:' })).toBeNull();
    fireEvent.click(sources().getByRole('button', { name: 'Text and Markdown' }));
    expect(screen.getByText('Add to:').parentElement).toHaveTextContent('Add to: Private');
    pick('Trip.md');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    const status = screen.getByRole('status');
    await waitFor(() =>
      expect(status).toHaveTextContent(
        'Importing Trip.md into Private. You can keep working while it runs.',
      ),
    );
    expect(status).toHaveFocus();
    expect(calls).toEqual(['GET ', 'POST ', `PUT /${ID}/file`]);
    expect(JSON.parse(String(bodies[1]))).toMatchObject({ source: 'markdown', pageId: null });
    expect(tracker.snapshot()).toEqual({ imports: [view('waiting')], open: true });
    expect(tracker.request(ID)?.file.name).toBe('Trip.md');
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    expect(screen.getByText('Drop the file here')).toBeInTheDocument();
  });

  it('adds to the page it was opened from, or to Private', async () => {
    const { bodies } = serve(started);
    show({ pathname: '/import', search: `?to=${SUPPORT}`, state: { title: 'Support' } });
    fireEvent.click(sources().getByRole('button', { name: 'Text and Markdown' }));
    const to = screen.getByRole('group', { name: 'Add to:' });
    expect(within(to).getByRole('radio', { name: 'Support' })).toBeChecked();
    pick('Trip.md');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(bodies).toHaveLength(3));
    expect(JSON.parse(String(bodies[1]))).toMatchObject({ pageId: SUPPORT });

    fireEvent.click(within(to).getByRole('radio', { name: 'Private' }));
    expect(within(to).getByRole('radio', { name: 'Private' })).toBeChecked();
    pick('Trip.md');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(bodies).toHaveLength(6));
    expect(JSON.parse(String(bodies[4]))).toMatchObject({ pageId: null });
  });

  it("names the page it was opened from when it doesn't know its title, and ignores bad ids", () => {
    show({ pathname: '/import', search: `?to=${SUPPORT}` });
    fireEvent.click(sources().getByRole('button', { name: 'Word' }));
    expect(screen.getByRole('radio', { name: 'This page' })).toBeChecked();
  });

  it('ignores a destination that is not a page id', () => {
    show('/import?to=../settings');
    fireEvent.click(sources().getByRole('button', { name: 'Word' }));
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('warns before importing the same file into the same place again', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const earlier = view('done', { finishedAt: yesterday, createdAt: yesterday });
    const { calls } = serve({ ...started, 'GET ': () => json(200, { imports: [earlier] }) });
    show();
    fireEvent.click(sources().getByRole('button', { name: 'Text and Markdown' }));
    pick('Trip.md');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import again?' });
    expect(dialog).toHaveTextContent('You imported Trip.md into Private yesterday.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls).toEqual(['GET ']);

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Import again' }),
    );
    await waitFor(() => expect(calls).toEqual(['GET ', 'GET ', 'POST ', `PUT /${ID}/file`]));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("says why an import didn't start, and tries again", async () => {
    let answer = json(403, { error: { code: 'forbidden', message: 'Forbidden.' } });
    const { calls } = serve({ ...started, 'POST ': () => answer });
    show();
    fireEvent.click(sources().getByRole('button', { name: 'Text and Markdown' }));
    pick('Trip.md');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("You can't add pages there.");
    answer = json(201, { import: view('uploading') });
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Importing Trip.md'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(calls).toEqual(['GET ', 'POST ', 'POST ', `PUT /${ID}/file`]);
  });

  it('says big imports are best done on a computer, on a phone', () => {
    window.matchMedia = ((query: string) => ({
      matches: query.startsWith('not all'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    show();
    expect(screen.getByText('Big imports are best done on a computer.')).toBeInTheDocument();
  });
});

describe('the words around the file', () => {
  it('gives sizes and endings as people read them', () => {
    expect([1, 12, 820_400, 1_500_000].map(sizeWords)).toEqual([
      '1 byte',
      '12 bytes',
      '820 KB',
      '1.5 MB',
    ]);
    expect(endingsWords(['.docx'])).toBe('.docx');
    expect(endingsWords(['.md', '.txt', '.zip'])).toBe('.md, .txt or .zip');
  });
});
