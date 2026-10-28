import { z } from 'zod';
import type { ClaudeFeature } from './index';

// Settings → Claude and the on/off status, shared by the server's /api/claude routes and the web app
// (docs/extras/claude.md, "Settings → Claude"). Import from '@carehub/extras/claude/settings'.

/** The workspace setting for how long assistant chats are kept. */
export const CLAUDE_CHAT_RETENTION_KEY = 'claude.chatRetentionDays';

/** CL-D3: chats are kept until deleted (null). An Admin may choose one of these instead. */
export const CHAT_RETENTION_DAYS = [30, 90, 365] as const;

export const chatRetentionSchema = z
  .union([z.literal(30), z.literal(90), z.literal(365)])
  .nullable();

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

/** GET /api/claude/settings (Admins only). */
export const claudeSettingsViewSchema = z.object({
  /** Whether the server has ANTHROPIC_API_KEY. Its value never leaves the server. */
  keySet: z.boolean(),
  /** ANTHROPIC_MODEL (CL-D1). */
  model: z.string(),
  /** "Approved for this workspace". No switch works without it. */
  workspaceApproved: z.boolean(),
  switches: z.object(switches),
  chatRetentionDays: chatRetentionSchema,
  usage: z.object({
    /** This calendar month in America/Denver, as YYYY-MM. */
    month: z.string(),
    requests: count,
    /** CLAUDE_MONTHLY_REQUESTS (CL-D2). */
    monthlyRequests: count,
    byFeature: z.object(counts),
  }),
});
export type ClaudeSettingsView = z.infer<typeof claudeSettingsViewSchema>;

/** PUT /api/claude/settings: only what changes. */
export const claudeSettingsUpdateSchema = z
  .object({
    workspaceApproved: z.boolean().optional(),
    switches: z.object(switches).partial().strict().optional(),
    chatRetentionDays: chatRetentionSchema.optional(),
  })
  .strict();
export type ClaudeSettingsUpdate = z.infer<typeof claudeSettingsUpdateSchema>;

/**
 * GET /api/claude/status: which features the signed-in person can use now (the key, the approval,
 * the switch and claude.use). The web app asks every few seconds and hides what's off.
 */
export const claudeStatusSchema = z.object({ on: z.object(switches) });
export type ClaudeStatus = z.infer<typeof claudeStatusSchema>;
