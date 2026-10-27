// @carehub/extras/claude: names every Claude feature shares, on the server, in the web app and in
// other lanes (Learning help, the Meetings summary). Rules: docs/extras/claude.md.

/**
 * Each feature has its own workspace switch, off by default. Nothing is sent to Claude unless the
 * server has a key and that feature's switch is on. An Admin turns a switch on only through its
 * confirm, with "Nav has given the OK" ticked (Claude features spec, section 3.1).
 */
export const CLAUDE_FEATURES = [
  'writing_help',
  'assistant',
  'fields',
  'meeting_summary',
  'learning_help',
] as const;

export type ClaudeFeature = (typeof CLAUDE_FEATURES)[number];

/** The switch names Admins see in Settings → Claude (Claude features spec, section 3.1). */
export const CLAUDE_FEATURE_LABELS: Readonly<Record<ClaudeFeature, string>> = {
  writing_help: 'Writing help',
  assistant: 'Assistant',
  fields: 'Claude fields',
  meeting_summary: 'Meeting summary',
  learning_help: 'Learning help',
};

/**
 * What each switch sends to Claude: the line under it in Settings → Claude, and its confirm.
 * Writing help's is the spec's own (section 3.1); the others say what sections 3.3 to 3.5 send,
 * and Learning help what Learning decision 0315 allows.
 */
export const CLAUDE_FEATURE_SENDS: Readonly<Record<ClaudeFeature, string>> = {
  writing_help:
    "Writing help sends the text people select, and the text around it, to Anthropic's Claude.",
  assistant:
    "The assistant sends people's questions, and the pages they let it read, to Anthropic's Claude.",
  fields:
    "Claude fields send the row properties each field uses, and the row's page content if the field uses it, to Anthropic's Claude.",
  meeting_summary:
    "Meeting summary sends a meeting's agenda, notes, action items and attendees' names to Anthropic's Claude, and the transcript only if the person asking recorded it.",
  learning_help:
    "Learning help sends the course titles and lesson text authors work on to Anthropic's Claude, never anything about learners.",
};

/** The rest of every switch's confirm. */
export const CLAUDE_NAV_OK_NOTE = "Only turn this on with Nav's written OK.";

/** The tick in every switch's confirm. Turn on stays grey until it's ticked. */
export const CLAUDE_NAV_OK_LABEL = 'Nav has given the OK';

/** The workspace setting that holds a feature's switch, for example `claude.writing_help`. */
export function claudeSwitchKey<F extends ClaudeFeature>(feature: F): `claude.${F}` {
  return `claude.${feature}`;
}

export function isClaudeFeature(value: string): value is ClaudeFeature {
  return (CLAUDE_FEATURES as readonly string[]).includes(value);
}

/** Why a Claude request was refused or failed. The server never says more than this. */
export const CLAUDE_ERROR_REASONS = [
  'not_set_up',
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
  switched_off: {
    status: 409,
    code: 'conflict',
    message: 'This Claude feature is switched off. An Admin can turn it on in Settings → Claude.',
  },
  no_permission: { status: 403, code: 'forbidden', message: "You don't have access to this." },
  monthly_cap: {
    status: 429,
    code: 'rate_limited',
    message: "Claude has reached this month's limit. An Admin can raise it in Settings → Claude.",
  },
  user_rate_limit: {
    status: 429,
    code: 'rate_limited',
    message: "You've asked a lot this hour. Try again in a few minutes.",
  },
  too_long: {
    status: 413,
    code: 'too_large',
    message: "That's too much text to send to Claude. Try a shorter part.",
  },
  unavailable: {
    status: 409,
    code: 'conflict',
    message: "Claude isn't available right now.",
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
