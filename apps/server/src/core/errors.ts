import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/** Error codes for 4xx answers (decision 0007, section 2.2). */
export type ErrorCode =
  'invalid' | 'signed_out' | 'forbidden' | 'not_found' | 'conflict' | 'too_large' | 'rate_limited';

export const DEFAULT_ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  invalid: "Some of the information isn't right. Check it and try again.",
  signed_out: 'Sign in to continue.',
  forbidden: "You don't have access to this.",
  not_found: 'This was deleted, or the link is wrong.',
  conflict: 'This changed in the meantime. Reload and try again.',
  too_large: "That's over the size limit.",
  rate_limited: 'Too many tries. Wait a minute and try again.',
};

const CODE_FOR_STATUS: Readonly<Record<number, ErrorCode>> = {
  400: 'invalid',
  401: 'signed_out',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'too_large',
  429: 'rate_limited',
};

/** Throw it from a route or hook: the answer is `{ error: { code, message, details? } }` with this status. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(statusCode: number, code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? DEFAULT_ERROR_MESSAGES[code]);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** For example `throw httpError(404, 'not_found')`. Without a message, the default one for the code. */
export function httpError(
  status: number,
  code: ErrorCode,
  message?: string,
  details?: unknown,
): HttpError {
  return new HttpError(status, code, message, details);
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function errorBody(code: string, message: string, details?: unknown): ErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/**
 * The app's error handler. HttpErrors as thrown; zod errors become 400 `invalid` with the issues (never the
 * values sent); other 4xx errors get the code and message for their status; anything else is logged and
 * answered with a plain 500.
 */
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send(errorBody(error.code, error.message, error.details));
  }
  if (error instanceof ZodError) {
    const details = error.issues.map(({ code, path, message }) => ({ code, path, message }));
    const message = error.issues[0]?.message ?? DEFAULT_ERROR_MESSAGES.invalid;
    return reply.code(400).send(errorBody('invalid', message, details));
  }
  const status = error.statusCode ?? 500;
  if (status >= 400 && status < 500) {
    const code = CODE_FOR_STATUS[status] ?? 'invalid';
    return reply.code(status).send(errorBody(code, DEFAULT_ERROR_MESSAGES[code]));
  }
  request.log.error({ err: error }, 'request failed');
  return reply
    .code(500)
    .send(errorBody('server_error', 'Something went wrong on our side. Try again in a moment.'));
}
