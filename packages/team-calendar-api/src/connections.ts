import { z } from 'zod';
import { layerColorSchema } from './layers';
import { idSchema, instantSchema } from './values';

/** From the Calendar spec: connections per person, and events kept per calendar. */
export const CONNECTION_LIMITS = { connections: 10, eventsPerCalendar: 5_000 } as const;

export const connectionKindSchema = z.enum(['google', 'google-bridge', 'icloud', 'link']);
export type ConnectionKind = z.infer<typeof connectionKindSchema>;

/** `needs-reconnect`: sign in again (Reconnect). `error`: the last read failed (Retry). */
export const connectionStatusSchema = z.enum(['ok', 'needs-reconnect', 'error']);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

/** One calendar of a connection. While shown, it's the layer `connected:<id>`. */
export const connectedCalendarSchema = z.object({
  id: idSchema,
  name: z.string(),
  color: layerColorSchema,
  /** Only shown calendars are read and get a layer. */
  shown: z.boolean(),
  /** It has more events than Care Hub keeps, so some don't show. */
  truncated: z.boolean(),
});
export type ConnectedCalendar = z.infer<typeof connectedCalendarSchema>;

/** A connection as its owner sees it: never a token, a password or the private link. */
export const connectionSchema = z.object({
  id: idSchema,
  kind: connectionKindSchema,
  label: z.string(),
  /** The account, masked like 'a…@example.com'. Null for links. */
  account: z.string().nullable(),
  status: connectionStatusSchema,
  /** Why the last read failed, in plain words. */
  lastError: z.string().nullable(),
  lastSyncedAt: instantSchema.nullable(),
  calendars: z.array(connectedCalendarSchema),
});
export type Connection = z.infer<typeof connectionSchema>;

/** `GET /api/calendar/connections` and `POST /api/calendar/connections/refresh` */
export const connectionsResponseSchema = z.object({
  connections: z.array(connectionSchema),
  /** Why a way of connecting can't be used on this server, in plain words. Null when it can. */
  unavailable: z.object({ google: z.string().nullable() }),
});
export type ConnectionsResponse = z.infer<typeof connectionsResponseSchema>;

/** `PATCH /api/calendar/connections/:id`, `POST .../:id/sync` and `POST .../links` (201) */
export const connectionResponseSchema = z.object({ connection: connectionSchema });

/** `POST /api/calendar/connections/google`: with `connectionId` to reconnect that one. */
export const googleConnectSchema = z.strictObject({ connectionId: idSchema.optional() });
/** Send the person to `url`, Google's sign-in screen. */
export const googleConnectResponseSchema = z.object({ url: z.url({ protocol: /^https$/ }) });

const labelSchema = z
  .string()
  .trim()
  .min(1, 'Give it a name.')
  .max(100, 'Names can be up to 100 characters.');

/** `PATCH /api/calendar/connections/:id`: rename, or pick which calendars show. */
export const connectionPatchSchema = z
  .strictObject({
    label: labelSchema.optional(),
    calendars: z
      .array(z.strictObject({ id: idSchema, shown: z.boolean() }))
      .max(250)
      .optional(),
  })
  .refine((patch) => patch.label !== undefined || patch.calendars, 'Send at least one change.');
export type ConnectionPatch = z.infer<typeof connectionPatchSchema>;

/** The link reader's sentences for a link it turns down for its scheme, or for a password in it. */
export const LINK_SCHEME_MESSAGE = 'Calendar links must start with https:// or webcal://.';
export const LINK_CREDENTIALS_MESSAGE =
  "Links with a user name and password aren't supported. Use the calendar's private link, which has its secret in the address.";

/** A user name or password before the host, like https://name:password@…. */
function hasCredentials(link: string): boolean {
  try {
    const url = new URL(link);
    return url.username !== '' || url.password !== '';
  } catch {
    return false;
  }
}

/** `POST /api/calendar/connections/links`: subscribe to a private calendar link. */
export const linkConnectSchema = z.strictObject({
  url: z
    .string()
    .trim()
    .max(2000, 'Links can be up to 2,000 characters.')
    // webcal:// and webcals:// are read as https://.
    .regex(/^(https|webcals?):\/\/\S+$/i, LINK_SCHEME_MESSAGE)
    .refine((url) => !hasCredentials(url), LINK_CREDENTIALS_MESSAGE),
  label: labelSchema,
  color: layerColorSchema,
});
export type LinkConnect = z.infer<typeof linkConnectSchema>;

/** Why connecting Google didn't work: `problem` in `/calendar/connections?problem=<code>`. */
export const CONNECT_PROBLEMS = {
  'signed-out': 'Sign in to Care Hub, then connect again.',
  'missing-settings': "Google sign-in isn't set up yet.",
  'client-rejected':
    "Google didn't accept Care Hub's sign-in settings. Check the Google client ID, secret and redirect URL.",
  'state-mismatch': 'That sign-in link has expired. Please try connecting again.',
  cancelled: 'Google sign-in was cancelled.',
  'sign-in-failed': "Google sign-in didn't finish. Please try again.",
  'missing-scopes':
    'Care Hub needs to see your calendars and their events. Please connect again and allow both.',
  'no-refresh-token': "Google didn't keep Care Hub signed in. Please connect again.",
  revoked: 'Google needs you to sign in again.',
  'invalid-grant': 'Google needs you to sign in again.',
  network: "Couldn't reach Google. Please try again.",
  timeout: "Google didn't answer in time. Please try again.",
  unavailable: "Google isn't answering right now. Please try again in a few minutes.",
  'rate-limited': 'Google asked Care Hub to slow down. Please try again in a few minutes.',
  'unexpected-response': "Google sent an answer Care Hub didn't understand. Please try again.",
  limit: `You can connect up to ${CONNECTION_LIMITS.connections} calendars. Remove one to add another.`,
  'other-account':
    'That was a different Google account. Reconnect with the account this calendar uses, or connect the other one as a new calendar.',
} as const;
export type ConnectProblem = keyof typeof CONNECT_PROBLEMS;

/** The sentence for a `problem` code, or a general one for a code this version doesn't know. */
export function connectProblemMessage(code: string): string {
  return Object.hasOwn(CONNECT_PROBLEMS, code)
    ? CONNECT_PROBLEMS[code as ConnectProblem]
    : "Connecting didn't work. Please try again.";
}
