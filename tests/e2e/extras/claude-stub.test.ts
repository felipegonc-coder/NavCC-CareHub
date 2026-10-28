import { afterEach, describe, expect, it } from 'vitest';
import { startClaudeStub, STUB_JSON, STUB_TEXT, type ClaudeStub } from './claude-stub';

// Fictional key only.
const KEY = 'sk-ant-FICTIONAL-stub-test-key';

let stub: ClaudeStub | undefined;

afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

async function start(slowMs?: number) {
  stub = await startClaudeStub({ port: 0, ...(slowMs === undefined ? {} : { slowMs }) });
  return stub;
}

function ask(url: string, content: string, headers: Record<string, string> = {}) {
  return fetch(`${url}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': KEY,
      ...headers,
    },
    body: JSON.stringify({
      model: 'claude-test',
      max_tokens: 100,
      messages: [{ role: 'user', content }],
    }),
  });
}

describe('the Claude test stub', () => {
  it('answers like the Messages API, with canned text', async () => {
    const { url } = await start();
    const response = await ask(url, 'Shorten this.');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: 'message',
      role: 'assistant',
      model: 'claude-test',
      content: [{ type: 'text', text: STUB_TEXT }],
      stop_reason: 'end_turn',
    });
    expect(body.usage).toEqual({ input_tokens: expect.any(Number), output_tokens: 11 });
  });

  it('answers a meeting summary when asked for JSON, or the queued answers in order', async () => {
    const { url, answerNext } = await start();
    const text = async (response: Response) =>
      ((await response.json()) as { content: Array<{ text: string }> }).content[0]?.text;
    expect(JSON.parse((await text(await ask(url, 'Answer with one JSON value.'))) ?? '')).toEqual(
      STUB_JSON,
    );
    answerNext('First.');
    await fetch(`${url}/__answers`, { method: 'POST', body: JSON.stringify({ text: 'Second.' }) });
    expect(await text(await ask(url, 'Go.'))).toBe('First.');
    expect(await text(await ask(url, 'Go.'))).toBe('Second.');
    expect(await text(await ask(url, 'Go.'))).toBe(STUB_TEXT);
  });

  it('records every request with the key hidden, and forgets them when asked', async () => {
    const { url, requests } = await start();
    await ask(url, 'Shorten this.');
    const listed = (await (await fetch(`${url}/__requests`)).json()) as unknown[];
    expect(listed).toEqual(requests());
    expect(listed).toMatchObject([
      {
        method: 'POST',
        path: '/v1/messages',
        headers: { 'x-api-key': '<present>', 'anthropic-version': '2023-06-01' },
        body: { model: 'claude-test', messages: [{ role: 'user', content: 'Shorten this.' }] },
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain(KEY);
    expect((await fetch(`${url}/__requests`, { method: 'DELETE' })).status).toBe(204);
    expect(requests()).toEqual([]);
  });

  it('answers 429 for STUB-429 and 500 for STUB-500', async () => {
    const { url } = await start();
    const limited = await ask(url, 'Shorten STUB-429 please.');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('1');
    expect(await limited.json()).toMatchObject({
      type: 'error',
      error: { type: 'rate_limit_error' },
    });
    const failed = await ask(url, 'Shorten STUB-500 please.');
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ error: { type: 'api_error' } });
  });

  it('waits before answering STUB-SLOW', async () => {
    const { url } = await start(150);
    const started = Date.now();
    const response = await ask(url, 'Shorten STUB-SLOW please.');
    expect(response.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  });

  it('refuses requests without a key or an API version, and unknown paths', async () => {
    const { url, requests } = await start();
    expect((await ask(url, 'Hi.', { 'x-api-key': '' })).status).toBe(401);
    expect((await ask(url, 'Hi.', { 'anthropic-version': '' })).status).toBe(400);
    expect((await fetch(`${url}/v1/complete`, { method: 'POST' })).status).toBe(404);
    expect(requests()).toHaveLength(3);
  });

  it('listens only on 127.0.0.1', async () => {
    const { url } = await start();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
