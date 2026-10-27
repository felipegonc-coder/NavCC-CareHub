import { z } from 'zod';

/** One problem with the input, e.g. `{ path: 'lessons[0].title', message: 'Add a title.' }`. */
export const ApiIssueSchema = z.object({ path: z.string(), message: z.string() });
export type ApiIssue = z.infer<typeof ApiIssueSchema>;

/**
 * The body of every Learning API error (docs/learning/api.md): `{ error: { code, message, issues? } }`.
 * The message is plain words a person can act on; 403 and 404 never name the thing asked for.
 */
export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string().min(1).max(100),
    message: z.string().max(2000),
    issues: z.array(ApiIssueSchema).max(101).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

const INVALID = {
  code: 'invalid',
  message: "Some details aren't right. Check them and try again.",
};
const BY_STATUS: Record<number, { code: string; message: string }> = {
  400: INVALID,
  401: { code: 'signed_out', message: "You're signed out. Sign in again to continue." },
  403: { code: 'forbidden', message: "You don't have access to this." },
  404: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
  409: {
    code: 'conflict',
    message: 'This changed since you opened it. Reload to see the latest version.',
  },
  413: { code: 'too_large', message: 'This is larger than Care Hub allows.' },
  422: {
    code: 'cannot_publish',
    message: "This can't be published yet. Fix the problems listed first.",
  },
  429: { code: 'rate_limited', message: 'Too many tries. Wait a minute, then try again.' },
};
const SERVER_ERROR = {
  code: 'server_error',
  message: 'Something went wrong on our side. Try again soon.',
};

/** The code and plain message for an HTTP error status, when nothing more specific is known. */
export function errorForStatus(status: number): { code: string; message: string } {
  const known = BY_STATUS[status];
  if (known) return { ...known };
  if (status >= 400 && status < 500) return { ...INVALID };
  return { ...SERVER_ERROR };
}
