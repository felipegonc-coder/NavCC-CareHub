import {
  CLAUDE_ERROR_REASONS,
  CLAUDE_ERRORS,
  type ClaudeErrorReason,
} from '@carehub/extras/claude';
import { httpError, type HttpError } from '../../../core/errors';

/** Why a Claude request was refused or failed, with plain words for the screen. */
export class ClaudeError extends Error {
  readonly reason: ClaudeErrorReason;

  constructor(reason: ClaudeErrorReason) {
    super(CLAUDE_ERRORS[reason].message);
    this.name = 'ClaudeError';
    this.reason = reason;
  }
}

/** The reason of a ClaudeError, or undefined for any other error. */
export function claudeErrorReason(error: unknown): ClaudeErrorReason | undefined {
  if (!(error instanceof Error) || !('reason' in error)) return undefined;
  const { reason } = error;
  return CLAUDE_ERROR_REASONS.find((known) => known === reason);
}

/** What a route answers for a refused or failed request: CLAUDE_ERRORS[reason] with `details: { reason }`. */
export function claudeHttpError(reason: ClaudeErrorReason): HttpError {
  const { status, code, message } = CLAUDE_ERRORS[reason];
  return httpError(status, code, message, { reason });
}
