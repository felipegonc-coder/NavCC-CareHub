// Writing help's requests, with the 60-second wait and the words each failure shows in the result
// box (Claude features spec, section 3.6; CL-16, CL-17).
import {
  CLAUDE_ERROR_REASONS,
  CLAUDE_ERRORS,
  type ClaudeErrorReason,
} from '@carehub/extras/claude';
import {
  WRITE_LIMITS,
  writeResponseSchema,
  type WriteAction,
  type WriteApplied,
  type WriteRequestInput,
} from '@carehub/extras/claude/write';
import { api, ApiError } from '../../../lib/api';

/** How long an answer may take (section 3.6). */
export const WRITE_TIMEOUT_MS = 60_000;

export const UNAVAILABLE = "Claude isn't available right now.";

/** The words the spec gives; the other refusals use the shared ones. */
const REASON_TEXT: Partial<Record<ClaudeErrorReason, string>> = {
  monthly_cap: "Claude has reached this month's limit. An Admin can raise it in Settings → Claude.",
  user_rate_limit: "You've asked a lot this hour. Try again in a few minutes.",
};

/** The person pressed Stop or closed the box, so there's nothing to show. */
export class WriteStopped extends Error {
  override name = 'WriteStopped';
}

/** What the result box says instead of an answer. */
export interface WriteProblem {
  message: string;
  /** Try again may work: Claude was unreachable, too slow or said no. */
  canRetry: boolean;
}

/** Asking for more than section 3.2 allows: the person selects or types less. */
export function tooLongMessage(action: WriteAction): string {
  return action === 'draft'
    ? `That's too long. Say it in up to ${WRITE_LIMITS.prompt.toLocaleString('en-US')} characters.`
    : `Select less text. Claude can work on up to ${WRITE_LIMITS.selection.toLocaleString('en-US')} characters at a time.`;
}

/**
 * Claude's answer (Markdown) for one action. Rejects with WriteStopped after `signal` aborts, with
 * ApiError otherwise; after `timeoutMs` the request is dropped as unavailable.
 */
export async function askClaudeToWrite(
  input: WriteRequestInput,
  { signal, timeoutMs = WRITE_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  if (signal?.aborted) throw new WriteStopped('Stopped');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const answer = await api.post('/api/claude/write', input, {
      schema: writeResponseSchema,
      signal: controller.signal,
    });
    return answer.text;
  } catch (error) {
    if (signal?.aborted) throw new WriteStopped('Stopped');
    if (timedOut) throw new ApiError(0, 'timeout', UNAVAILABLE);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

function reasonOf(details: unknown): ClaudeErrorReason | null {
  if (typeof details !== 'object' || details === null || !('reason' in details)) return null;
  const { reason } = details;
  return typeof reason === 'string' && (CLAUDE_ERROR_REASONS as readonly string[]).includes(reason)
    ? (reason as ClaudeErrorReason)
    : null;
}

/** The words for a failed request. Anything unexpected reads as Claude being unavailable. */
export function writeProblem(error: unknown, action: WriteAction): WriteProblem {
  if (!(error instanceof ApiError)) return { message: UNAVAILABLE, canRetry: true };
  const reason = reasonOf(error.details);
  if (reason === 'unavailable' || reason === 'bad_output') {
    return { message: UNAVAILABLE, canRetry: true };
  }
  if (reason === 'too_long') return { message: tooLongMessage(action), canRetry: false };
  if (reason)
    return { message: REASON_TEXT[reason] ?? CLAUDE_ERRORS[reason].message, canRetry: false };
  if (error.status >= 400 && error.status < 500 && error.code !== 'invalid_response') {
    return { message: error.message, canRetry: false };
  }
  return { message: UNAVAILABLE, canRetry: true };
}

/**
 * Tells page history the edit was made with Claude ("Avery Lin (with Claude)"). The edit is
 * already in the page like any typing, so a failure here changes nothing else.
 */
export async function reportApplied(body: WriteApplied): Promise<void> {
  try {
    await api.post('/api/claude/write/applied', body);
  } catch {
    // History then shows the edit without "(with Claude)".
  }
}
