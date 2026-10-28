import type { ImportView } from '@carehub/extras/import-export/import/index';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../../lib/api';
import { importsApi } from './client';
import { TOO_BIG } from './prepare';

const view: ImportView = {
  id: '6f1c1f9e-8f3a-4f52-9a43-5d0f6f1d2c11',
  source: 'markdown',
  fileName: 'Trip.md',
  size: 6,
  status: 'waiting',
  destination: { pageId: null, title: 'Private' },
  progress: null,
  counts: null,
  problems: [],
  problemCount: 0,
  error: null,
  canUndo: false,
  createdAt: '2026-10-27T10:00:00.000Z',
  finishedAt: null,
};

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  document.cookie = 'carehub_csrf=; max-age=0';
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Answers every request with `answer`, and keeps what was asked. */
function serve(answer: () => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    });
    return answer();
  };
  return calls;
}

describe('the import routes', () => {
  it('sends the file as the raw body, with the CSRF token', async () => {
    document.cookie = 'carehub_csrf=token%2B1';
    const calls = serve(() => json(200, { import: view }));
    const file = new Blob(['# Trip'], { type: 'text/markdown' });
    await expect(importsApi.send(view.id, file)).resolves.toEqual(view);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(`/api/import-export/imports/${view.id}/file`);
    expect(call?.method).toBe('PUT');
    expect(call?.body).toBe(file);
    expect(call?.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(call?.headers.get('X-CSRF-Token')).toBe('token+1');
  });

  it("says the server's reason when the file isn't taken", async () => {
    serve(() => json(409, { error: { code: 'conflict', message: 'This file was sent already.' } }));
    await expect(importsApi.send(view.id, new Blob(['x']))).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
      message: 'This file was sent already.',
    });
    serve(() => new Response('Request body is too large', { status: 413 }));
    await expect(importsApi.send(view.id, new Blob(['x']))).rejects.toMatchObject({
      status: 413,
      code: 'too_large',
      message: TOO_BIG,
    });
    serve(() => new Response('', { status: 502 }));
    await expect(importsApi.send(view.id, new Blob(['x']))).rejects.toMatchObject({
      status: 502,
      code: 'unexpected',
    });
    serve(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(importsApi.send(view.id, new Blob(['x']))).rejects.toBeInstanceOf(ApiError);
    await expect(importsApi.send(view.id, new Blob(['x']))).rejects.toMatchObject({
      status: 0,
      code: 'offline',
    });
  });

  it('starts, follows, cancels and undoes imports', async () => {
    document.cookie = 'carehub_csrf=token';
    const calls = serve(() => json(200, { import: view, imports: [view], preview: 'preview' }));
    const input = {
      source: 'markdown' as const,
      fileName: 'Trip.md',
      size: 6,
      pageId: null,
      planned: false,
    };
    await expect(importsApi.start(input)).resolves.toEqual(view);
    await expect(importsApi.list()).resolves.toEqual([view]);
    await expect(importsApi.get(view.id)).resolves.toEqual(view);
    await expect(importsApi.cancel(view.id)).resolves.toEqual(view);
    await expect(importsApi.undoPreview(view.id)).resolves.toBe('preview');
    await expect(importsApi.undo(view.id, true)).resolves.toEqual(view);
    const base = '/api/import-export/imports';
    expect(calls.map(({ method, url, body }) => [method, url, body])).toEqual([
      ['POST', base, JSON.stringify(input)],
      ['GET', base, undefined],
      ['GET', `${base}/${view.id}`, undefined],
      ['POST', `${base}/${view.id}/cancel`, undefined],
      ['GET', `${base}/${view.id}/undo`, undefined],
      ['POST', `${base}/${view.id}/undo`, JSON.stringify({ removeChanged: true })],
    ]);
    expect(calls[0]?.headers.get('X-CSRF-Token')).toBe('token');
  });
});
