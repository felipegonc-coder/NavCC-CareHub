import {
  ImportFileError,
  importSource,
  type ImportSource,
  type ImportView,
} from '@carehub/extras/import-export/import/index';
import { afterEach, describe, expect, it } from 'vitest';
import { startImport } from './start';

const markdown = importSource('markdown') as ImportSource;
const html = importSource('html') as ImportSource;

const view = (status: ImportView['status']): ImportView => ({
  id: '0b6f5a52-55f4-4d8e-a8f4-6f2f0f9d3a10',
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
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
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
    const route = Object.entries(routes).find(([key]) => `${method} ${url}`.endsWith(key));
    return route ? route[1]() : json(500, {});
  };
  return { calls, bodies };
}

const file = new File(['# Trip'], 'Trip.md');

describe('starting an import', () => {
  it('starts the import and sends the file, then it waits in line', async () => {
    const { calls, bodies } = serve({
      'POST ': () => json(201, { import: view('uploading') }),
      '/file': () => json(200, { import: view('waiting') }),
    });
    const result = await startImport({ source: markdown, file, pageId: null });
    expect(result).toEqual({ ok: true, import: view('waiting') });
    expect(calls).toEqual(['POST ', `PUT /${view('waiting').id}/file`]);
    expect(JSON.parse(String(bodies[0]))).toEqual({
      source: 'markdown',
      fileName: 'Trip.md',
      size: 6,
      pageId: null,
      planned: false,
    });
    expect(bodies[1]).toBe(file);
  });

  it('says why before anything is sent', async () => {
    const { calls } = serve({});
    expect(await startImport({ source: html, file, pageId: null })).toEqual({
      ok: false,
      message: 'Pick an .html or .zip file.',
    });
    const page = new File(['<p>Trip</p>'], 'Trip.html');
    const failing = (error: Error) => ({
      importers: {
        html: {
          source: 'html' as const,
          plan: async () => {
            throw error;
          },
        },
      },
    });
    const request = { source: html, file: page, pageId: null };
    expect(await startImport(request, failing(new ImportFileError('the page is empty')))).toEqual({
      ok: false,
      message: 'The import stopped: the page is empty. Nothing was added.',
    });
    expect(await startImport(request, failing(new TypeError('x is undefined')))).toEqual({
      ok: false,
      message: "The import stopped: the file couldn't be read. Nothing was added.",
    });
    expect(calls).toEqual([]);
  });

  it("gives the server's reasons, and cancels an import whose file didn't arrive", async () => {
    const busy = 'Wait for one of your imports to finish, then try again.';
    serve({ 'POST ': () => json(429, { error: { code: 'rate_limited', message: busy } }) });
    expect(await startImport({ source: markdown, file, pageId: null })).toEqual({
      ok: false,
      message: busy,
    });
    serve({ 'POST ': () => json(403, { error: { code: 'forbidden' } }) });
    expect(await startImport({ source: markdown, file, pageId: null })).toEqual({
      ok: false,
      message: "You can't add pages there.",
    });
    const { calls } = serve({
      'POST ': () => json(201, { import: view('uploading') }),
      '/file': () => json(400, { error: { code: 'invalid', message: 'The file is empty.' } }),
      '/cancel': () => json(200, { import: view('cancelled') }),
    });
    expect(await startImport({ source: markdown, file, pageId: null })).toEqual({
      ok: false,
      message: 'The file is empty.',
    });
    const id = view('cancelled').id;
    expect(calls).toEqual(['POST ', `PUT /${id}/file`, `POST /${id}/cancel`]);
  });
});
