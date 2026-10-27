import { z } from 'zod';

/** Readable cookie with the CSRF token. Send its value in the X-CSRF-Token header on every POST, PUT, PATCH and DELETE to /api. */
export const CSRF_COOKIE = 'carehub_csrf';
/** The X-CSRF-Token header, in lower case as Node reports it. */
export const CSRF_HEADER = 'x-csrf-token';
export const DEFAULT_TIME_ZONE = 'America/Denver';

/** `request.user` on the server; `user` in GET /api/auth/me. */
export const currentUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  /** Manages accounts and the server. Gives no permission inside a workspace by itself. */
  isSiteAdmin: z.boolean(),
  /** IANA time zone, default America/Denver. */
  timeZone: z.string(),
  use24h: z.boolean(),
  /** 0 = Sunday … 6 = Saturday. */
  weekStart: z.number().int().min(0).max(6),
  /** Signed in with a temporary password: only me, password and sign-out work until a new one is chosen. */
  mustChangePassword: z.boolean(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

/** GET /api/auth/me. `member` and `workspace` are filled in by the roles PR (null until then). */
export const meResponseSchema = z.object({
  user: currentUserSchema,
  member: z.null(),
  workspace: z.null(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
