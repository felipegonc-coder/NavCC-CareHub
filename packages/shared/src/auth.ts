import { z } from 'zod';
import { permissionKeySchema } from './permissions';

// The shared index has one line for accounts, so the permission keys come along from here.
export * from './permissions';

/**
 * Readable cookie with the CSRF token: `__Host-carehub_csrf` over HTTPS, `carehub_csrf` on a plain-HTTP
 * development server. Send `readCsrfToken(document.cookie)` in the X-CSRF-Token header on every POST, PUT,
 * PATCH and DELETE to /api.
 */
export const CSRF_COOKIE = 'carehub_csrf';
/** The server's cookie names start with this when cookies are Secure, so only this exact host can set them. */
export const SECURE_COOKIE_PREFIX = '__Host-';

/** The CSRF token in a Cookie header or `document.cookie`, or null. Prefers the `__Host-` cookie. */
export function readCsrfToken(cookies: string): string | null {
  const values = new Map<string, string>();
  for (const part of cookies.split(';')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    const name = part.slice(0, at).trim();
    if (!values.has(name)) values.set(name, part.slice(at + 1).trim());
  }
  return values.get(SECURE_COOKIE_PREFIX + CSRF_COOKIE) ?? values.get(CSRF_COOKIE) ?? null;
}

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

export const membershipKindSchema = z.enum(['member', 'guest']);
export type MembershipKind = z.infer<typeof membershipKindSchema>;

/**
 * `member` in GET /api/auth/me (on the server, `request.member` has `permissions` as a ReadonlySet).
 * Guests have no role and no permissions: they reach only what's shared with them (0007, section 3.2).
 */
export const currentMemberSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('member'),
    workspaceId: z.string(),
    roleId: z.string(),
    roleName: z.string(),
    permissions: z.array(permissionKeySchema),
    /** The role has `workspace.admin`. */
    isAdmin: z.boolean(),
  }),
  z.object({
    kind: z.literal('guest'),
    workspaceId: z.string(),
    roleId: z.null(),
    roleName: z.null(),
    permissions: z.array(permissionKeySchema).max(0),
    isAdmin: z.literal(false),
  }),
]);
export type CurrentMemberJson = z.infer<typeof currentMemberSchema>;

export const workspaceSummarySchema = z.object({ id: z.string(), name: z.string() });
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;

/** GET /api/auth/me. `member` is null for someone who isn't in the workspace (or was removed). */
export const meResponseSchema = z.object({
  user: currentUserSchema,
  member: currentMemberSchema.nullable(),
  workspace: workspaceSummarySchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;
