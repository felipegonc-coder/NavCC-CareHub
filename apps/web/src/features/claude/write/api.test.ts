import { CLAUDE_ERRORS } from '@carehub/extras/claude';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api';
import {
  askClaudeToWrite,
  reportApplied,
  tooLongMessage,
  UNAVAILABLE,
  writeProblem,
  WriteStopped,
} from './api';

const pageId = 'f1b0c7de-0000-4000-8000-000000000003';
const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A request that only ends when its signal aborts, like a slow answer. */
function hangs(_path: unknown, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('Aborted', 'AbortError')),
    );
  });
}

const refusal = (status: number, code: string, reason?: string, message = 'Refused.') =>
  new ApiError(status, code, message, reason ? { reason } : undefined);

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('asking Claude to write', () => {
  it('posts the action and gives back the answer', async () => {
    fetchMock.mockResolvedValue(json(200, { text: 'A shorter paragraph.' }));
    const input = {
      pageId,
      action: 'make_shorter' as const,
      selection: 'A long paragraph.',
      at: 12,
    };
    await expect(askClaudeToWrite(input)).resolves.toBe('A shorter paragraph.');
    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/api/claude/write');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });

  it('stops when the person presses Stop', async () => {
    fetchMock.mockImplementation(hangs);
    const stop = new AbortController();
    const answer = askClaudeToWrite(
      { pageId, action: 'continue', selection: 'Hello' },
      { signal: stop.signal },
    );
    stop.abort();
    await expect(answer).rejects.toBeInstanceOf(WriteStopped);
  });

  it('gives up after the wait, as unavailable', async () => {
    fetchMock.mockImplementation(hangs);
    const error = await askClaudeToWrite({ pageId, action: 'summarize' }, { timeoutMs: 5 }).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(writeProblem(error, 'summarize')).toEqual({ message: UNAVAILABLE, canRetry: true });
  });

  it('turns a refusal from the server into an ApiError with its reason', async () => {
    fetchMock.mockResolvedValue(
      json(429, {
        error: { code: 'rate_limited', message: 'Slow down.', details: { reason: 'monthly_cap' } },
      }),
    );
    const error = await askClaudeToWrite({ pageId, action: 'improve', selection: 'Hi' }).catch(
      (reason: unknown) => reason,
    );
    expect(writeProblem(error, 'improve')).toEqual({
      message: "Claude has reached this month's limit. An Admin can raise it in Settings → Claude.",
      canRetry: false,
    });
  });
});

describe('what the result box says when there is no answer', () => {
  it('offers Try again when Claude was unreachable, slow or said no', () => {
    for (const error of [
      refusal(409, 'conflict', 'unavailable'),
      refusal(409, 'conflict', 'bad_output'),
      new ApiError(0, 'offline', "Can't reach Care Hub."),
      new ApiError(502, 'unexpected', 'Bad gateway'),
      new ApiError(200, 'invalid_response', 'Unexpected'),
      new Error('boom'),
    ]) {
      expect(writeProblem(error, 'improve')).toEqual({ message: UNAVAILABLE, canRetry: true });
    }
  });

  it('uses the spec words for the limits', () => {
    expect(writeProblem(refusal(429, 'rate_limited', 'user_rate_limit'), 'simplify')).toEqual({
      message: "You've asked a lot this hour. Try again in a few minutes.",
      canRetry: false,
    });
    expect(writeProblem(refusal(413, 'too_large', 'too_long'), 'draft').message).toBe(
      tooLongMessage('draft'),
    );
  });

  it('passes on other refusals without Try again', () => {
    expect(writeProblem(refusal(409, 'conflict', 'switched_off'), 'improve')).toEqual({
      message: CLAUDE_ERRORS.switched_off.message,
      canRetry: false,
    });
    expect(
      writeProblem(
        refusal(403, 'forbidden', undefined, "You don't have access to this."),
        'improve',
      ),
    ).toEqual({ message: "You don't have access to this.", canRetry: false });
  });

  it('asks for less text, with the limit', () => {
    expect(tooLongMessage('improve')).toBe(
      'Select less text. Claude can work on up to 10,000 characters at a time.',
    );
    expect(tooLongMessage('draft')).toBe("That's too long. Say it in up to 2,000 characters.");
  });
});

describe('telling history the edit was made with Claude', () => {
  it('posts where the text went and ignores a failure', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const body = { pageId, action: 'improve' as const, placement: 'replace' as const };
    await reportApplied(body);
    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/api/claude/write/applied');
    expect(JSON.parse(String(init?.body))).toEqual(body);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(reportApplied(body)).resolves.toBeUndefined();
  });
});
