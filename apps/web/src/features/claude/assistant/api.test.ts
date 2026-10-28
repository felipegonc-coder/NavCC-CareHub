import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../../lib/api';
import { UNAVAILABLE } from '../write/api';
import {
  askAssistant,
  askProblem,
  AskStopped,
  findPages,
  loadViewerId,
  PICKER_RESULTS,
  TOO_MUCH,
} from './api';

const NOW = '2026-10-27T09:00:00.000Z';
const CHAT = { id: 'c1', title: 'Refunds', questions: 1, createdAt: NOW, updatedAt: NOW };
const message = (role: 'question' | 'answer', text: string) => ({
  id: `${role}-1`,
  role,
  text,
  scope: role === 'question' ? 'all_pages' : null,
  pages: [],
  sources: role === 'answer' ? [{ id: 'p1', title: 'Refund policy' }] : [],
  createdAt: NOW,
});

const realFetch = globalThis.fetch;
let requests: { url: string; method: string; body: unknown }[];
let reply: (signal: AbortSignal | null | undefined) => Promise<Response>;

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

const hang = (signal: AbortSignal | null | undefined) =>
  new Promise<Response>((_, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });

beforeEach(() => {
  requests = [];
  reply = () => json(200, {});
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return reply(init?.signal);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('assistant requests', () => {
  it('asks one question and checks the answer', async () => {
    reply = () =>
      json(200, {
        chat: CHAT,
        question: message('question', 'How long?'),
        answer: message('answer', '5 days.'),
      });
    const response = await askAssistant({ question: 'How long?', scope: 'all_pages', pageIds: [] });
    expect(requests).toEqual([
      {
        url: '/api/claude/assistant/ask',
        method: 'POST',
        body: { question: 'How long?', scope: 'all_pages', pageIds: [] },
      },
    ]);
    expect(response.answer.sources).toEqual([{ id: 'p1', title: 'Refund policy' }]);
  });

  it('stops when the person presses Stop', async () => {
    reply = hang;
    const stop = new AbortController();
    const asking = askAssistant(
      { question: 'How long?', scope: 'no_pages', pageIds: [] },
      { signal: stop.signal },
    );
    stop.abort();
    await expect(asking).rejects.toBeInstanceOf(AskStopped);
  });

  it('gives up as unavailable when Claude takes too long', async () => {
    reply = hang;
    const asking = askAssistant(
      { question: 'How long?', scope: 'no_pages', pageIds: [] },
      { timeoutMs: 5 },
    );
    await expect(asking).rejects.toMatchObject({
      status: 0,
      code: 'timeout',
      message: UNAVAILABLE,
    });
  });

  it('says what went wrong, with Try again only when it may help', () => {
    const tooMuch = new ApiError(400, 'claude_error', 'Too long.', { reason: 'too_long' });
    expect(askProblem(tooMuch)).toEqual({ message: TOO_MUCH, canRetry: false });
    const down = new ApiError(503, 'claude_error', 'Down.', { reason: 'unavailable' });
    expect(askProblem(down)).toEqual({ message: UNAVAILABLE, canRetry: true });
    expect(askProblem(new Error('anything'))).toEqual({ message: UNAVAILABLE, canRetry: true });
  });

  it('finds pages for @ with Care Hub Search', async () => {
    reply = () =>
      json(200, { results: [{ id: 'p1', title: 'Refund policy', path: ['Policies'] }] });
    expect(await findPages('refund')).toEqual([{ id: 'p1', title: 'Refund policy' }]);
    expect(requests[0]).toMatchObject({
      url: '/api/search/query',
      method: 'POST',
      body: { text: 'refund', limit: PICKER_RESULTS },
    });
  });

  it('knows who is signed in', async () => {
    reply = () => json(200, { user: { id: 'user-avery', name: 'Avery Lin' }, member: {} });
    expect(await loadViewerId()).toBe('user-avery');
  });
});
