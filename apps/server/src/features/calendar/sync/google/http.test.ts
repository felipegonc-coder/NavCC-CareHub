import { describe, expect, it } from 'vitest';
import { GOOGLE_TIMEOUT_MS, TransportError, readJson, readText, timeLimit } from './http';

const MB = 1024 * 1024;

/** A body sent in 1 MB pieces with no declared size. Counts the pieces read. */
function streamed(pieces: number) {
  const sent = { pieces: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent.pieces === pieces) return controller.close();
      sent.pieces += 1;
      controller.enqueue(new Uint8Array(MB).fill(0x20));
    },
    cancel() {
      sent.cancelled = true;
    },
  });
  return { response: new Response(body), sent };
}

describe('reading replies', () => {
  it('reads text and JSON within the limit, whatever the pieces', async () => {
    expect(await readText(new Response('héllo'), 10)).toBe('héllo');
    expect(await readJson(new Response('{"ok":true}'), 100)).toEqual({ ok: true });
    expect(await readJson(new Response(null, { status: 204 }), 100)).toBeUndefined();
    const split = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x68, 0xc3]));
        controller.enqueue(new Uint8Array([0xa9]));
        controller.close();
      },
    });
    expect(await readText(new Response(split), 3)).toBe('hé');
    expect(await readText(streamed(2).response, 2 * MB)).toHaveLength(2 * MB);
  });

  it('stops at a declared size over the limit, before reading', async () => {
    const response = new Response('{}', { headers: { 'content-length': String(11 * MB) } });
    await expect(readText(response, 10 * MB)).rejects.toThrow(TransportError);
  });

  it('stops reading a reply once it passes the limit', async () => {
    const { response, sent } = streamed(20);
    const error = await readText(response, 10 * MB).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ code: 'too-large', retryable: false });
    expect((error as Error).message).toBe('Google sent an answer too large for Care Hub to read.');
    expect(sent.pieces).toBeLessThan(13);
    expect(sent.cancelled).toBe(true);
  });
});

describe('time limit', () => {
  it('gives each call 10 seconds, and tells a timeout from a cancel', async () => {
    expect(GOOGLE_TIMEOUT_MS).toBe(10_000);
    const quick = timeLimit(undefined, 10);
    await new Promise((resolve) => quick.signal.addEventListener('abort', resolve));
    expect(quick.timedOut()).toBe(true);
    const controller = new AbortController();
    const cancelled = timeLimit(controller.signal);
    controller.abort();
    expect(cancelled.signal.aborted).toBe(true);
    expect(cancelled.timedOut()).toBe(false);
  });
});
