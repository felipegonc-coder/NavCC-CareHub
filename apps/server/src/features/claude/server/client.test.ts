import { describe, expect, it } from 'vitest';
import { ANTHROPIC_VERSION, sendToClaude } from './client';
import { ClaudeError } from './errors';
import type { ClaudeLogDetails, ClaudeRuntime } from './runtime';
import { CLAUDE_MESSAGES_URL, readClaudeSettings } from './settings';

// A fictional key: the test fails if it shows up anywhere it must not.
const KEY = 'sk-ant-FICTIONAL-test-key-0001';

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

const answer = (text: string) =>
  reply(200, { content: [{ type: 'text', text }], usage: { input_tokens: 12, output_tokens: 5 } });

/** A runtime whose fetch answers from `replies` in order (an Error is thrown instead of answering). */
function fakeRuntime(replies: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const sleeps: number[] = [];
  const logs: Array<{ details: ClaudeLogDetails; message: string }> = [];
  const runtime: ClaudeRuntime = {
    settings: () => ({
      apiKey: KEY,
      model: 'claude-test',
      monthlyRequests: 3000,
      url: CLAUDE_MESSAGES_URL,
    }),
    db: undefined,
    access: { settingsOn: async (_db, _id, keys) => new Set(keys), canUseClaude: async () => true },
    pages: { canOpenPage: async () => true },
    fetch: async (url, init) => {
      calls.push({ url, init });
      const next = replies.shift();
      if (!next) throw new Error('No more fake replies');
      if (next instanceof Error) throw next;
      return next;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: { warn: (details, message) => logs.push({ details, message }) },
    now: () => new Date(),
  };
  return { runtime, calls, sleeps, logs };
}

const request = { system: 'Be brief.', user: 'Say hello.', maxTokens: 300 };

async function failure(promise: Promise<unknown>): Promise<ClaudeError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ClaudeError);
  return error as ClaudeError;
}

describe('sendToClaude', () => {
  it('posts one message to the fixed URL, refusing redirects, with a timeout', async () => {
    const { runtime, calls } = fakeRuntime([answer('Hello there.')]);
    const result = await sendToClaude(runtime, request);
    expect(result).toEqual({ text: 'Hello there.', inputTokens: 12, outputTokens: 5 });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call?.init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    expect(call?.init.headers).toMatchObject({
      'anthropic-version': ANTHROPIC_VERSION,
      'x-api-key': KEY,
    });
    expect(JSON.parse(String(call?.init.body))).toEqual({
      model: 'claude-test',
      max_tokens: 300,
      system: 'Be brief.',
      messages: [{ role: 'user', content: 'Say hello.' }],
    });
  });

  it('tries 429 and 5xx again at most twice, with backoff', async () => {
    const busy = { type: 'error', error: { type: 'overloaded_error', message: 'busy' } };
    const ok = fakeRuntime([
      reply(429, busy, { 'retry-after': '2' }),
      reply(529, busy),
      answer('Done.'),
    ]);
    expect((await sendToClaude(ok.runtime, request)).text).toBe('Done.');
    expect(ok.sleeps).toEqual([2000, 3000]);

    const down = fakeRuntime([
      reply(500, busy),
      reply(502, busy),
      reply(503, busy),
      answer('Too late.'),
    ]);
    expect((await failure(sendToClaude(down.runtime, request))).reason).toBe('unavailable');
    expect(down.calls).toHaveLength(3);
    expect(down.logs.map((line) => line.details.claude)).toEqual([
      { status: 500, type: 'overloaded_error' },
      { status: 502, type: 'overloaded_error' },
      { status: 503, type: 'overloaded_error' },
    ]);
  });

  it('never tries other 4xx answers again', async () => {
    const bad = { type: 'error', error: { type: 'invalid_request_error', message: 'no' } };
    for (const [status, reason] of [
      [400, 'unavailable'],
      [401, 'not_set_up'],
      [413, 'too_long'],
    ] as const) {
      const { runtime, calls } = fakeRuntime([reply(status, bad), answer('Again?')]);
      expect((await failure(sendToClaude(runtime, request))).reason).toBe(reason);
      expect(calls).toHaveLength(1);
    }
  });

  it('answers unavailable for a timeout, no connection or an unreadable reply', async () => {
    const timeout = Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
    const slow = fakeRuntime([timeout]);
    expect((await failure(sendToClaude(slow.runtime, request))).reason).toBe('unavailable');
    expect(slow.logs[0]?.details).toEqual({ claude: { status: 0, type: 'TimeoutError' } });

    const garbled = fakeRuntime([reply(200, '<html>not json</html>')]);
    expect((await failure(sendToClaude(garbled.runtime, request))).reason).toBe('unavailable');
    expect(garbled.logs[0]?.details).toEqual({ claude: { status: 200, type: 'unreadable_reply' } });
  });

  it('sends nothing without a key', async () => {
    const { runtime, calls } = fakeRuntime([answer('Hi')]);
    const noKey = { ...runtime, settings: () => ({ ...runtime.settings(), apiKey: undefined }) };
    expect((await failure(sendToClaude(noKey, request))).reason).toBe('not_set_up');
    expect(calls).toHaveLength(0);
  });

  it('never puts the key, the request or Anthropic’s message in logs, errors or answers', async () => {
    const echo = {
      type: 'error',
      error: { type: `bad key ${KEY}`, message: `Your key ${KEY} and prompt Say hello.` },
    };
    const { runtime, logs } = fakeRuntime([
      reply(401, echo),
      new Error(`connect failed for ${KEY}`),
      answer('A plain answer.'),
    ]);
    const errors = [
      await failure(sendToClaude(runtime, request)),
      await failure(sendToClaude(runtime, request)),
    ];
    const result = await sendToClaude(runtime, request);
    const everything = JSON.stringify({
      logs,
      errors: errors.map((e) => [e.message, e.stack]),
      result,
    });
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain('Say hello.');
    expect(logs.map((line) => line.details.claude)).toEqual([
      { status: 401, type: 'unknown' },
      { status: 0, type: 'Error' },
    ]);
  });
});

describe('readClaudeSettings', () => {
  const warnings: string[] = [];
  const log = { warn: (message: string) => warnings.push(message) };

  it('uses the fixed URL, the default model and 3,000 requests a month', () => {
    expect(readClaudeSettings({ env: {}, log })).toEqual({
      apiKey: undefined,
      model: 'claude-sonnet-4-5',
      monthlyRequests: 3000,
      url: 'https://api.anthropic.com/v1/messages',
    });
  });

  it('accepts a stub only on 127.0.0.1 while test hooks are on, and never repeats the key', () => {
    const env = {
      ANTHROPIC_API_KEY: KEY,
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:4010/',
      CAREHUB_TEST_HOOKS: '1',
    };
    expect(readClaudeSettings({ env, log }).url).toBe('http://127.0.0.1:4010/v1/messages');
    for (const outside of [
      'https://claude.example.test',
      'http://10.0.0.5:4010',
      'http://localhost:4010',
      'http://localhost.example.test:80',
    ]) {
      const settings = readClaudeSettings({ env: { ...env, ANTHROPIC_BASE_URL: outside }, log });
      expect(settings.url).toBe('https://api.anthropic.com/v1/messages');
    }
    expect(warnings).toHaveLength(4);
    expect(warnings.join('\n')).not.toContain(KEY);
  });

  it("doesn't even read the stub's address without test hooks", () => {
    warnings.length = 0;
    for (const hooks of [undefined, '0']) {
      const env = { ANTHROPIC_BASE_URL: 'http://127.0.0.1:4010', CAREHUB_TEST_HOOKS: hooks };
      expect(readClaudeSettings({ env, log }).url).toBe('https://api.anthropic.com/v1/messages');
      const elsewhere = { ...env, ANTHROPIC_BASE_URL: 'https://claude.example.test' };
      expect(readClaudeSettings({ env: elsewhere, log }).url).toBe(
        'https://api.anthropic.com/v1/messages',
      );
    }
    expect(warnings).toEqual([]);
  });
});
