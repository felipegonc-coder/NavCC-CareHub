import { z } from 'zod';
import { CLAUDE_NAV_OK_LABEL, type ClaudeFeature } from './index';

// Settings → Claude and the on/off status, shared by the server's /api/claude routes and the web app
// (docs/extras/claude.md, "Settings → Claude"). Import from '@carehub/extras/claude/settings'.

/** The workspace setting for how long assistant chats are kept. */
export const CLAUDE_CHAT_RETENTION_KEY = 'claude.chatRetentionDays';

/** CL-D3: chats are kept until deleted (null). An Admin may choose one of these instead. */
export const CHAT_RETENTION_DAYS = [30, 90, 365] as const;

export const chatRetentionSchema = z
  .union([z.literal(30), z.literal(90), z.literal(365)])
  .nullable();

/** The workspace setting for the monthly limit an Admin chose. Unsaved, it's the default. */
export const CLAUDE_MONTHLY_LIMIT_KEY = 'claude.monthlyRequests';

/** The highest monthly limit, the same as for CLAUDE_MONTHLY_REQUESTS on the server. */
export const MAX_MONTHLY_REQUESTS = 1_000_000;

/** CL-D2: requests per workspace per month. 0 stops Claude until the limit is raised. */
export const monthlyLimitSchema = z.number().int().min(0).max(MAX_MONTHLY_REQUESTS);

const switches = {
  writing_help: z.boolean(),
  assistant: z.boolean(),
  fields: z.boolean(),
  meeting_summary: z.boolean(),
  learning_help: z.boolean(),
} satisfies Record<ClaudeFeature, z.ZodBoolean>;

const count = z.number().int().min(0);
const counts = {
  writing_help: count,
  assistant: count,
  fields: count,
  meeting_summary: count,
  learning_help: count,
} satisfies Record<ClaudeFeature, typeof count>;

/** Who last turned a switch on or off, and when; null if nobody ever has. */
export const claudeSwitchChangeSchema = z
  .object({
    /** The person's name, or null once their account is gone. */
    by: z.string().nullable(),
    at: z.iso.datetime({ offset: true }),
  })
  .nullable();
export type ClaudeSwitchChange = z.infer<typeof claudeSwitchChangeSchema>;

const changes = {
  writing_help: claudeSwitchChangeSchema,
  assistant: claudeSwitchChangeSchema,
  fields: claudeSwitchChangeSchema,
  meeting_summary: claudeSwitchChangeSchema,
  learning_help: claudeSwitchChangeSchema,
} satisfies Record<ClaudeFeature, typeof claudeSwitchChangeSchema>;

/** GET /api/claude/settings (Admins only). */
export const claudeSettingsViewSchema = z.object({
  /** Whether the server has ANTHROPIC_API_KEY. Its value never leaves the server. */
  keySet: z.boolean(),
  /** ANTHROPIC_MODEL (CL-D1). */
  model: z.string(),
  switches: z.object(switches),
  lastChanged: z.object(changes),
  chatRetentionDays: chatRetentionSchema,
  usage: z.object({
    /** This calendar month in America/Denver, as YYYY-MM. */
    month: z.string(),
    requests: count,
    /** The workspace's monthly limit: what an Admin saved, or CLAUDE_MONTHLY_REQUESTS (CL-D2). */
    monthlyRequests: count,
    byFeature: z.object(counts),
  }),
});
export type ClaudeSettingsView = z.infer<typeof claudeSettingsViewSchema>;

/** Why turning a switch on was refused: its confirm wasn't ticked. */
export const NAV_OK_REQUIRED = `Tick "${CLAUDE_NAV_OK_LABEL}" to turn a feature on.`;

/**
 * PUT /api/claude/settings: only what changes. Turning any switch on needs `navOk: true`, which the
 * web app sends only from that switch's confirm, once "Nav has given the OK" is ticked.
 */
export const claudeSettingsUpdateSchema = z
  .object({
    switches: z.object(switches).partial().strict().optional(),
    navOk: z.literal(true).optional(),
    monthlyRequests: monthlyLimitSchema.optional(),
    chatRetentionDays: chatRetentionSchema.optional(),
  })
  .strict()
  .refine((update) => update.navOk === true || !turnsSwitchOn(update), {
    message: NAV_OK_REQUIRED,
    path: ['navOk'],
  });
export type ClaudeSettingsUpdate = z.infer<typeof claudeSettingsUpdateSchema>;

/** Whether an update turns any switch on. */
export function turnsSwitchOn(update: {
  switches?: Partial<Record<ClaudeFeature, boolean>>;
}): boolean {
  return Object.values(update.switches ?? {}).some((on) => on === true);
}

/**
 * GET /api/claude/status: which features the signed-in person can use now (the key, the switch and
 * claude.use). The web app asks every few seconds and hides what's off.
 */
export const claudeStatusSchema = z.object({ on: z.object(switches) });
export type ClaudeStatus = z.infer<typeof claudeStatusSchema>;
