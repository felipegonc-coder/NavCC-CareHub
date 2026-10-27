import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createLiveHub, type LiveHub } from './domain/hub';
import { parseFrames, type ParsedFrame } from './domain/testSink';
import { openLiveStream } from './sse';

let server: Server | undefined;
let hub: LiveHub;

async function start(): Promise<string> {
  hub = createLiveHub({ createId: () => 'conn-1' });
  server = createServer((_request, response) => {
    openLiveStream(hub, 'user-avery', response);
  });
  server.keepAliveTimeout = 72_000; // Fastify's default
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

/** Reads until `count` frames have arrived (or the stream ends). */
async function readFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
): Promise<ParsedFrame[]> {
  const decoder = new TextDecoder();
  let text = '';
  while (text.split('\n\n').length - 1 < count) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return parseFrames(text);
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !condition(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(condition()).toBe(true);
}

afterEach(async () => {
  hub?.closeAll();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

describe('openLiveStream', () => {
  it('streams hello, then events, with no-cache and no-buffering headers', async () => {
    const response = await fetch(await start());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache, no-store, no-transform');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const reader = response.body!.getReader();
    expect(await readFrames(reader, 1)).toEqual([
      { event: 'hello', retry: 3000, data: { connectionId: 'conn-1', heartbeatMs: 25_000 } },
    ]);
    hub.publishToUsers(['user-avery'], { type: 'job-updated', data: { jobId: 'j1' } });
    expect(await readFrames(reader, 1)).toEqual([
      { event: 'message', data: { type: 'job-updated', data: { jobId: 'j1' } } },
    ]);
    hub.closeAll();
    expect(await reader.read()).toMatchObject({ done: true });
  });

  it('forgets the connection when the client goes away', async () => {
    const controller = new AbortController();
    const response = await fetch(await start(), { signal: controller.signal });
    await readFrames(response.body!.getReader(), 1);
    expect(hub.stats().connections).toBe(1);
    controller.abort();
    await waitFor(() => hub.stats().connections === 0);
  });

  it('lets the server close promptly once the streams end (shutdown order)', async () => {
    const response = await fetch(await start());
    const reader = response.body!.getReader();
    await readFrames(reader, 1);
    const closed = new Promise<void>((resolve) => server?.close(() => resolve()));
    hub.closeAll();
    while (!(await reader.read()).done);
    const started = Date.now();
    await closed;
    server = undefined;
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
