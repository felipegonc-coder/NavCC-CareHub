// @carehub/extras/claude: names every Claude feature shares, on the server, in the web app and in
// other lanes (Learning help, the Meetings summary). Rules: docs/extras/claude.md.

/**
 * Each feature has its own workspace switch, off by default. Nothing is sent to Claude unless the
 * server has a key, an Admin has ticked "Nav has given the OK", and that feature's switch is on.
 */
export const CLAUDE_FEATURES = [
  'writing_help',
  'assistant',
  'fields',
  'meeting_summary',
  'learning_help',
] as const;

export type ClaudeFeature = (typeof CLAUDE_FEATURES)[number];

/** The switch names Admins see in Settings → Claude. */
export const CLAUDE_FEATURE_LABELS: Readonly<Record<ClaudeFeature, string>> = {
  writing_help: 'Writing help in pages',
  assistant: 'Assistant panel',
  fields: 'Claude fields in databases',
  meeting_summary: 'Meeting summaries',
  learning_help: 'Learning help',
};

/** The workspace setting that holds a feature's switch, for example `claude.writing_help`. */
export function claudeSwitchKey<F extends ClaudeFeature>(feature: F): `claude.${F}` {
  return `claude.${feature}`;
}

/** The workspace setting an Admin ticks once Nav has given the OK. No switch works without it. */
export const CLAUDE_APPROVAL_KEY = 'claude.navApproved';

export function isClaudeFeature(value: string): value is ClaudeFeature {
  return (CLAUDE_FEATURES as readonly string[]).includes(value);
}

/** Why a Claude request was refused or failed. The server never says more than this. */
export const CLAUDE_ERROR_REASONS = [
  'not_set_up',
  'not_approved',
  'switched_off',
  'no_permission',
  'monthly_cap',
  'user_rate_limit',
  'too_long',
  'unavailable',
  'bad_output',
] as const;

export type ClaudeErrorReason = (typeof CLAUDE_ERROR_REASONS)[number];

export interface ClaudeErrorInfo {
  /** The HTTP status and error code the routes answer with (decision 0007, section 2.2). */
  status: 403 | 409 | 413 | 429;
  code: 'forbidden' | 'conflict' | 'too_large' | 'rate_limited';
  /** Plain words for the screen. Routes send `details: { reason }` too. */
  message: string;
}

export const CLAUDE_ERRORS: Readonly<Record<ClaudeErrorReason, ClaudeErrorInfo>> = {
  not_set_up: {
    status: 409,
    code: 'conflict',
    message: "Claude isn't set up on this server yet.",
  },
  not_approved: {
    status: 409,
    code: 'conflict',
    message:
      'Claude is off until an Admin confirms in Settings → Claude that Nav has given the OK.',
  },
  switched_off: {
    status: 409,
    code: 'conflict',
    message: 'This Claude feature is switched off. An Admin can turn it on in Settings → Claude.',
  },
  no_permission: { status: 403, code: 'forbidden', message: "You don't have access to this." },
  monthly_cap: {
    status: 429,
    code: 'rate_limited',
    message: "This workspace has used this month's Claude requests. They start again on the 1st.",
  },
  user_rate_limit: {
    status: 429,
    code: 'rate_limited',
    message:
      "You've sent a lot of Claude requests in a short time. Wait a few minutes and try again.",
  },
  too_long: {
    status: 413,
    code: 'too_large',
    message: "That's too much text to send to Claude. Try a shorter part.",
  },
  unavailable: {
    status: 409,
    code: 'conflict',
    message: "Claude didn't answer. Try again in a moment.",
  },
  bad_output: {
    status: 409,
    code: 'conflict',
    message: "Claude's answer couldn't be used. Try again.",
  },
};

export {
  MEETING_SUMMARY_LIMITS,
  meetingActionItemSchema,
  meetingSummarySchema,
  type MeetingActionItem,
  type MeetingSummary,
} from './meeting';
