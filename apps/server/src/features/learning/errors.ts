import { errorForStatus, parseWith, type ApiErrorBody, type ApiIssue } from '@carehub/learning';
import type { z } from 'zod';
import { HttpError } from '../../core/errors';

/** An error the Learning API sends as `{ error: { code, message, issues? } }` with its status. */
export class LearningError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: ApiIssue[] | undefined;

  constructor(status: number, code: string, message: string, issues?: ApiIssue[]) {
    super(message);
    this.name = 'LearningError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

/** The standard error for a status, e.g. `httpError(404)` or `httpError(409, 'Someone else saved first.')`. */
export function httpError(status: number, message?: string, issues?: ApiIssue[]): LearningError {
  const standard = errorForStatus(status);
  return new LearningError(status, standard.code, message ?? standard.message, issues);
}

/** Reads request input with a zod schema; problems become a 400 with readable issues. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = parseWith(schema, input);
  if (result.ok) return result.value;
  throw httpError(400, undefined, result.issues);
}

/**
 * The status and body for anything thrown in a Learning route. Our own errors keep their details, and so do
 * core's (the sign-in and security checks that run before every route); Fastify's (a bad JSON body, a body
 * that's too large) keep their status with a plain message; anything else is a 500 that says nothing about
 * the cause.
 */
export function errorReply(error: unknown): { status: number; body: ApiErrorBody } {
  if (error instanceof LearningError) {
    const { code, message, issues } = error;
    return {
      status: error.status,
      body: { error: issues ? { code, message, issues: firstIssues(issues) } : { code, message } },
    };
  }
  if (error instanceof HttpError && error.statusCode >= 400 && error.statusCode < 500) {
    return {
      status: error.statusCode,
      body: { error: { code: error.code, message: error.message } },
    };
  }
  const status = httpStatusOf(error);
  return { status, body: { error: errorForStatus(status) } };
}

const MAX_ISSUES = 100;

/** At most 100 issues, then one that says how many more there are. */
function firstIssues(issues: ApiIssue[]): ApiIssue[] {
  if (issues.length <= MAX_ISSUES) return issues;
  const more = issues.length - MAX_ISSUES;
  return [...issues.slice(0, MAX_ISSUES), { path: '', message: `And ${more} more.` }];
}

function httpStatusOf(error: unknown): number {
  const status =
    typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : 500;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : 500;
}
