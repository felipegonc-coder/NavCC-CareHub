import {
  CLAUDE_APPROVAL_KEY,
  CLAUDE_FEATURES,
  claudeSwitchKey,
  type ClaudeErrorReason,
  type ClaudeFeature,
} from '@carehub/extras/claude';
import type { z } from 'zod';
import type { Db, Tx } from '../../../db';
import { sendToClaude, type ClaudeReply } from './client';
import { ClaudeError, claudeErrorReason } from './errors';
import { buildPrompt, MAX_REQUEST_CHARS, requestChars, type ClaudeDocument } from './prompt';
import { claudeRuntime, type ClaudeRuntime } from './runtime';
import {
  finishUsage,
  requestsInFlight,
  requestsSince,
  requestsThisMonth,
  reserveUsage,
  withClaudeLocks,
} from './usage';

/** The longest answer, in tokens, any feature gets. `maxTokens` can only lower it. */
export const MAX_TOKENS = 2048;
/** Each person's limit, so one person can't use up the workspace's monthly requests. */
export const PERSON_REQUESTS = 30;
export const PERSON_WINDOW_MS = 10 * 60_000;
/** Requests one person can have waiting on Claude at once, in any workspace. */
export const PERSON_IN_FLIGHT = 3;

export interface AskClaudeInput {
  workspaceId: string;
  userId: string;
  feature: ClaudeFeature;
  system: string;
  instruction: string;
  documents?: ClaudeDocument[];
  selection?: string;
  maxTokens?: number;
}

export interface AskClaudeJsonInput<T> extends AskClaudeInput {
  /** Claude's answer must parse as JSON and match this, or the request fails with bad_output. */
  schema: z.ZodType<T>;
}

/** Whether the server has the key, an Admin has given the OK, and the feature's switch is on. */
export async function isClaudeFeatureOn(
  db: Db | Tx,
  workspaceId: string,
  feature: ClaudeFeature,
): Promise<boolean> {
  return (await featureRefusal(db, workspaceId, feature)) === undefined;
}

/** isClaudeFeatureOn for every feature at once (GET /api/claude/status), from one settings read. */
export async function claudeFeaturesOn(
  db: Db | Tx,
  workspaceId: string,
): Promise<Record<ClaudeFeature, boolean>> {
  const { settings, access } = claudeRuntime();
  const { apiKey } = settings();
  const on = apiKey ? await access.settingsOn(db, workspaceId, EVERY_SETTING) : NOTHING_ON;
  const features = {} as Record<ClaudeFeature, boolean>;
  for (const feature of CLAUDE_FEATURES) {
    features[feature] = refusalFrom(apiKey, on, feature) === undefined;
  }
  return features;
}

/**
 * Asks Claude once, after every check in docs/extras/claude.md. The request counts from before it's
 * sent, on the runtime's own database, so its usage row stays even if the caller's work rolls back.
 * Pass `db`, not a transaction: the reservation needs a connection of its own.
 */
export function askClaude(db: Db | Tx, input: AskClaudeInput): Promise<{ text: string }> {
  return ask(db, input, (text) => ({ text }));
}

/** Like askClaude, for an answer in JSON checked with the caller's zod schema. */
export function askClaudeJson<T>(db: Db | Tx, input: AskClaudeJsonInput<T>): Promise<{ data: T }> {
  const { schema, ...request } = input;
  const instruction = `${request.instruction.trim()}\n\n${JSON_ONLY}`;
  return ask(db, { ...request, instruction }, (text) => ({ data: parseJson(text, schema) }));
}

const JSON_ONLY =
  'Answer with one JSON value and nothing else: no words around it and no code fences.';

/** The OK and every feature's switch: what GET /api/claude/status reads. */
const EVERY_SETTING = [CLAUDE_APPROVAL_KEY, ...CLAUDE_FEATURES.map(claudeSwitchKey)];
const NOTHING_ON: ReadonlySet<string> = new Set();

/** Why `feature` can't be used, given the server's key and the workspace's settings that are on. */
function refusalFrom(
  apiKey: string | undefined,
  on: ReadonlySet<string>,
  feature: ClaudeFeature,
): ClaudeErrorReason | undefined {
  if (!apiKey) return 'not_set_up';
  if (!on.has(CLAUDE_APPROVAL_KEY)) return 'not_approved';
  if (!on.has(claudeSwitchKey(feature))) return 'switched_off';
  return undefined;
}

async function featureRefusal(
  db: Db | Tx,
  workspaceId: string,
  feature: ClaudeFeature,
): Promise<ClaudeErrorReason | undefined> {
  const { settings, access } = claudeRuntime();
  const { apiKey } = settings();
  if (!apiKey) return 'not_set_up';
  const keys = [CLAUDE_APPROVAL_KEY, claudeSwitchKey(feature)];
  return refusalFrom(apiKey, await access.settingsOn(db, workspaceId, keys), feature);
}

/**
 * Checks the caps and reserves the request's usage row in one transaction on the runtime's own
 * database, holding the workspace's lock and then the person's, so requests sent at the same moment
 * can't all pass. A refusal leaves no row.
 */
async function reserve(runtime: ClaudeRuntime, input: AskClaudeInput, now: Date) {
  const { db } = runtime;
  if (!db) {
    runtime.log.warn({ claude: { status: 0, type: 'no_database' } }, 'claude: request refused');
    throw new ClaudeError('unavailable');
  }
  const { workspaceId, userId, feature } = input;
  const id = await withClaudeLocks(
    db,
    [`workspace:${workspaceId}`, `person:${userId}`],
    async (tx) => {
      if ((await requestsThisMonth(tx, workspaceId, now)) >= runtime.settings().monthlyRequests) {
        throw new ClaudeError('monthly_cap');
      }
      const since = new Date(now.getTime() - PERSON_WINDOW_MS);
      if ((await requestsSince(tx, userId, since)) >= PERSON_REQUESTS) {
        throw new ClaudeError('user_rate_limit');
      }
      if ((await requestsInFlight(tx, userId, now)) >= PERSON_IN_FLIGHT) {
        throw new ClaudeError('user_rate_limit');
      }
      return reserveUsage(tx, { workspaceId, userId, feature, createdAt: now });
    },
  );
  return { db, id };
}

async function ask<T>(db: Db | Tx, input: AskClaudeInput, finish: (text: string) => T): Promise<T> {
  const runtime = claudeRuntime();
  const refused = await featureRefusal(db, input.workspaceId, input.feature);
  if (refused) throw new ClaudeError(refused);
  if (!(await runtime.access.canUseClaude(db, input.workspaceId, input.userId))) {
    throw new ClaudeError('no_permission');
  }
  if (requestChars(input) > MAX_REQUEST_CHARS) throw new ClaudeError('too_long');
  const usage = await reserve(runtime, input, runtime.now());

  let reply: ClaudeReply;
  try {
    reply = await sendToClaude(runtime, {
      ...buildPrompt(input),
      maxTokens: maxTokens(input.maxTokens),
    });
  } catch (error) {
    // No answer came back: the request still counts toward the caps, with no tokens.
    await finishUsage(usage.db, usage.id, { status: claudeErrorReason(error) ?? 'unavailable' });
    throw error;
  }

  const tokens = { inputTokens: reply.inputTokens, outputTokens: reply.outputTokens };
  let result: T;
  try {
    if (!reply.text) throw new ClaudeError('bad_output');
    result = finish(reply.text);
  } catch (error) {
    const status = claudeErrorReason(error) ?? 'bad_output';
    await finishUsage(usage.db, usage.id, { ...tokens, status });
    throw error;
  }
  await finishUsage(usage.db, usage.id, { ...tokens, status: 'ok' });
  return result;
}

function maxTokens(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return MAX_TOKENS;
  return Math.max(1, Math.min(MAX_TOKENS, Math.floor(requested)));
}

function parseJson<T>(text: string, schema: z.ZodType<T>): T {
  const bare = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let value: unknown;
  try {
    value = JSON.parse(bare);
  } catch {
    throw new ClaudeError('bad_output');
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ClaudeError('bad_output');
  return parsed.data;
}
