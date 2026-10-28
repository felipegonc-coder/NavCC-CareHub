import { z } from 'zod';
import { readSettings, type ReadSettingsOptions } from '../../../core/settings';

/** The only address Claude is called at (docs/extras/claude.md, "One way out"). */
export const CLAUDE_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
/** The model when ANTHROPIC_MODEL is unset. CL-D1: the server settings file chooses it. */
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5';
/** CL-D2: requests per workspace per month when CLAUDE_MONTHLY_REQUESTS is unset. */
export const DEFAULT_MONTHLY_REQUESTS = 3000;

// Tests only: a local stub. Plain http on 127.0.0.1 with a port, and nothing else.
const LOOPBACK_URL = /^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/;

const claudeSettingsSchema = z.object({
  ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
  ANTHROPIC_MODEL: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/, 'Use a model name such as claude-sonnet-4-5.')
    .default(DEFAULT_CLAUDE_MODEL),
  CLAUDE_MONTHLY_REQUESTS: z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .default(DEFAULT_MONTHLY_REQUESTS),
});

/** Read only while test hooks are on (decision 0007, section 2.3), so never in production. */
const stubSettingsSchema = z.object({
  ANTHROPIC_BASE_URL: z
    .string()
    .regex(LOOPBACK_URL, 'Only http://127.0.0.1:<port> is accepted.')
    .optional(),
});

/** Decision 0007, section 2.3. Only end-to-end test servers set it; never production. */
const testHookSettings = z.object({ CAREHUB_TEST_HOOKS: z.enum(['0', '1']).optional() });

// stand-in: core's testHooksEnabled() (decision 0007, section 2.3) isn't on main yet. Until it is,
// this is the same CAREHUB_TEST_HOOKS check the jobs routes make.
function testHooksEnabled(options: ReadSettingsOptions): boolean {
  return readSettings(testHookSettings, options).CAREHUB_TEST_HOOKS === '1';
}

export interface ClaudeSettings {
  /** Goes only in the x-api-key header to Anthropic: never in the database, logs, errors or answers. */
  apiKey: string | undefined;
  model: string;
  monthlyRequests: number;
  /** CLAUDE_MESSAGES_URL, or the local stub's /v1/messages while test hooks are on. */
  url: string;
}

/** Claude's server settings (docs/extras/settings.md). An invalid value counts as unset. */
export function readClaudeSettings(options: ReadSettingsOptions = {}): ClaudeSettings {
  const values = readSettings(claudeSettingsSchema, options);
  const stub = testHooksEnabled(options)
    ? readSettings(stubSettingsSchema, options).ANTHROPIC_BASE_URL?.replace(/\/$/, '')
    : undefined;
  return {
    apiKey: values.ANTHROPIC_API_KEY,
    model: values.ANTHROPIC_MODEL,
    monthlyRequests: values.CLAUDE_MONTHLY_REQUESTS,
    url: stub ? `${stub}/v1/messages` : CLAUDE_MESSAGES_URL,
  };
}
