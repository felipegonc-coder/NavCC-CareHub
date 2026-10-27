import { z } from 'zod';
import { permissionKeySchema } from './permissions';

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

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

/** POST /api/auth/sign-in. Answers like GET /api/auth/me. */
export const signInBodySchema = z.object({
  email: z.string().trim().min(1, 'Enter your email.').max(254, "That isn't an email."),
  password: z
    .string()
    .min(1, 'Enter your password.')
    .max(PASSWORD_MAX_LENGTH, "That password doesn't match."),
});
export type SignInBody = z.infer<typeof signInBodySchema>;

/** POST /api/auth/password. `newPassword` must also pass `passwordProblem`. */
export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(PASSWORD_MAX_LENGTH),
  newPassword: z.string(),
});
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

// The built-in list of common passwords: the words people build them from. Variants such as
// "P@ssw0rd2024!" and "welcome12345" are caught too (see `isCommonPassword`).
const COMMON_WORDS = new Set(
  (
    'password passwort passcode welcome letmein iloveyou iloveu admin administrator root login ' +
    'changeme secret default guest user test testing qwerty monkey dragon sunshine princess ' +
    'football baseball basketball soccer hockey superman batman starwars trustno master shadow ' +
    'freedom whatever computer internet hello flower summer winter spring autumn love lovely ' +
    'angel cookie cheese chocolate killer hunter ranger mustang abc abcd care carehub nurse ' +
    'health hospital company office work'
  ).split(' '),
);

const SEQUENCES = [
  '01234567890123456789',
  'abcdefghijklmnopqrstuvwxyz',
  'qwertyuiopasdfghjklzxcvbnm',
  '1q2w3e4r5t6y7u8i9o0p',
  'qazwsxedcrfvtgbyhnujmikolp',
  '!@#$%^&*()_+',
];
const BOTH_WAYS = [...SEQUENCES, ...SEQUENCES.map((s) => [...s].reverse().join(''))];

/** Repeats (aaaa, abcabc) and runs along the alphabet, the digits or the keyboard, either way. */
function isPattern(text: string): boolean {
  if (text.length < 2) return false;
  return /^(.+?)\1+$/s.test(text) || BOTH_WAYS.some((sequence) => sequence.includes(text));
}

const LOOKALIKES: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
};
const plain = (text: string) => text.replace(/[0-9@$!]/g, (c) => LOOKALIKES[c] ?? c);

/** A password in lower case split into its middle and the digits and symbols around it. */
function split(lower: string) {
  const [, before = '', middle = '', after = ''] = /^([^a-z]*)(.*?)([^a-z]*)$/s.exec(lower) ?? [];
  return { before, middle: plain(middle), after };
}

/** Digits and symbols people add to a word: a few of each, or a run such as 12345. */
function isAddOn(text: string): boolean {
  const digits = text.replace(/[^0-9]/g, '');
  const symbols = text.replace(/[0-9]/g, '');
  return (digits.length <= 4 || isPattern(digits)) && (symbols.length <= 3 || isPattern(symbols));
}

function isCommonPassword(lower: string): boolean {
  if (isPattern(lower)) return true;
  const { before, middle, after } = split(lower);
  if (!isAddOn(before) || !isAddOn(after)) return false;
  const repeated = /^(.+?)\1+$/s.exec(middle)?.[1] ?? middle;
  return (
    middle.length <= 2 ||
    COMMON_WORDS.has(middle) ||
    COMMON_WORDS.has(repeated) ||
    (middle.length >= 3 && isPattern(middle))
  );
}

function isSignInName(lower: string, signInName: string): boolean {
  const email = signInName.trim().toLowerCase();
  if (email && lower.includes(email)) return true;
  const name = (email.split('@')[0] ?? '').replace(/[^a-z]/g, '');
  const { before, middle, after } = split(lower);
  return (
    name.length >= 3 && middle.replace(/[^a-z]/g, '') === name && isAddOn(before) && isAddOn(after)
  );
}

/**
 * Why a new password can't be used, in plain words, or null if it can (Settings and members,
 * Account): at least 12 characters, not a common password and not the sign-in name.
 */
export function passwordProblem(password: string, signInName: string): string | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  const lower = password.toLowerCase();
  if (isSignInName(lower, signInName)) return "Don't use your email in your password.";
  if (isCommonPassword(lower)) {
    return 'This password is too easy to guess. Try three or four words that have nothing in common.';
  }
  return null;
}
