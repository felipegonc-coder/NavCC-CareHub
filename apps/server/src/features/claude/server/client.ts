import type { ClaudeErrorReason } from '@carehub/extras/claude';
import { z } from 'zod';
import { ClaudeError } from './errors';
import type { ClaudeRuntime } from './runtime';

// The only code that calls Claude (docs/extras/claude.md, "Security rules"): the built-in fetch,
// redirects refused, a 30 s timeout, no tools, and a log line with only a status and an error type.

export const ANTHROPIC_VERSION = '2023-06-01';
export const REQUEST_TIMEOUT_MS = 30_000;
/** 429 and 5xx are tried again at most this many times. Other 4xx answers never are. */
export const MAX_RETRIES = 2;
const BACKOFF_MS = [1_000, 3_000];
const LONGEST_RETRY_AFTER_MS = 10_000;

export interface ClaudeRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface ClaudeReply {
  /** Claude's text blocks joined; empty if it sent none. */
  text: string;
  inputTokens: number;
  outputTokens: number;
}

const replySchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z
    .object({ input_tokens: z.number().int().min(0), output_tokens: z.number().int().min(0) })
    .optional(),
});

/** Sends one request to Claude's Messages API. Throws a ClaudeError for every failure. */
export async function sendToClaude(
  runtime: ClaudeRuntime,
  request: ClaudeRequest,
): Promise<ClaudeReply> {
  const { apiKey, model, url } = runtime.settings();
  if (!apiKey) throw new ClaudeError('not_set_up');
  const body = JSON.stringify({
    model,
    max_tokens: request.maxTokens,
    system: request.system,
    messages: [{ role: 'user', content: request.user }],
  });

  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await runtime.fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          'content-type': 'application/json',
          'anthropic-version': ANTHROPIC_VERSION,
          'x-api-key': apiKey,
        },
        body,
      });
    } catch (error) {
      // A timeout, a refused redirect or no connection: only the error's name is logged.
      logFailure(runtime, 0, failureName(error));
      throw new ClaudeError('unavailable');
    }
    if (response.ok) return readReply(runtime, response);

    logFailure(runtime, response.status, await errorType(response));
    if (isRetryable(response.status) && attempt < MAX_RETRIES) {
      await runtime.sleep(retryDelay(response, attempt));
      continue;
    }
    throw new ClaudeError(reasonFor(response.status));
  }
}

async function readReply(runtime: ClaudeRuntime, response: Response): Promise<ClaudeReply> {
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }
  const parsed = replySchema.safeParse(json);
  if (!parsed.success) {
    logFailure(runtime, response.status, 'unreadable_reply');
    throw new ClaudeError('unavailable');
  }
  const text = parsed.data.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim();
  return {
    text,
    inputTokens: parsed.data.usage?.input_tokens ?? 0,
    outputTokens: parsed.data.usage?.output_tokens ?? 0,
  };
}

function logFailure(runtime: ClaudeRuntime, status: number, type: string) {
  runtime.log.warn({ claude: { status, type } }, 'claude: request failed');
}

/** Anthropic's error type (for example rate_limit_error), never its message or the rest of the body. */
async function errorType(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const type = (body as { error?: { type?: unknown } } | null)?.error?.type;
    return typeof type === 'string' && /^[a-z_]{1,40}$/.test(type) ? type : 'unknown';
  } catch {
    return 'unknown';
  }
}

function failureName(error: unknown): string {
  return error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'unknown';
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelay(response: Response, attempt: number): number {
  const seconds = Number(response.headers.get('retry-after'));
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, LONGEST_RETRY_AFTER_MS);
  }
  return BACKOFF_MS[attempt] ?? LONGEST_RETRY_AFTER_MS;
}

function reasonFor(status: number): ClaudeErrorReason {
  if (status === 401 || status === 403) return 'not_set_up';
  if (status === 413) return 'too_long';
  return 'unavailable';
}
