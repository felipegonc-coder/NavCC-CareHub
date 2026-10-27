import {
  CLAUDE_FEATURES,
  claudeSwitchKey,
  type ClaudeErrorReason,
  type ClaudeFeature,
} from '@carehub/extras/claude';
import { CLAUDE_MONTHLY_LIMIT_KEY, monthlyLimitSchema } from '@carehub/extras/claude/settings';
import type { z } from 'zod';
import type { Db, Tx } from '../../../db';
import { sendToClaude, type ClaudeReply } from './client';
import { ClaudeError, claudeErrorReason } from './errors';
import { buildPrompt, MAX_REQUEST_CHARS, requestChars, type ClaudeDocument } from './prompt';
import { claudeRuntime } from './runtime';
import { recordUsage, requestsSince, requestsThisMonth } from './usage';
import { getWorkspaceSetting } from './workspace-settings';

/** The longest answer, in tokens, any feature gets. `maxTokens` can only lower it. */
export const MAX_TOKENS = 2048;
/** Each person's limit (Claude features spec, section 3.6): 60 requests an hour. */
export const PERSON_REQUESTS = 60;
export const PERSON_WINDOW_MS = 60 * 60_000;

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

/** Whether the server has the key and the feature's switch is on. */
export async function isClaudeFeatureOn(
  db: Db | Tx,
  workspaceId: string,
  feature: ClaudeFeature,
): Promise<boolean> {
  return (await featureRefusal(db, workspaceId, feature)) === undefined;
}

/** isClaudeFeatureOn for every feature at once (GET /api/claude/status). */
export async function claudeFeaturesOn(
  db: Db | Tx,
  workspaceId: string,
): Promise<Record<ClaudeFeature, boolean>> {
  const { settings, access } = claudeRuntime();
  const ready = Boolean(settings().apiKey);
  const on = {} as Record<ClaudeFeature, boolean>;
  for (const feature of CLAUDE_FEATURES) {
    on[feature] = ready && (await access.isSettingOn(db, workspaceId, claudeSwitchKey(feature)));
  }
  return on;
}

/** The workspace's monthly limit: what an Admin saved in Settings → Claude, or else the default. */
export function monthlyLimitFrom(saved: unknown, serverDefault: number): number {
  const limit = monthlyLimitSchema.safeParse(saved);
  return limit.success ? limit.data : serverDefault;
}

/**
 * Asks Claude once, after every check in docs/extras/claude.md. Pass `db`, not a transaction: the
 * usage row must stay even if the caller's work rolls back.
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

async function featureRefusal(
  db: Db | Tx,
  workspaceId: string,
  feature: ClaudeFeature,
): Promise<ClaudeErrorReason | undefined> {
  const { settings, access } = claudeRuntime();
  if (!settings().apiKey) return 'not_set_up';
  if (!(await access.isSettingOn(db, workspaceId, claudeSwitchKey(feature)))) return 'switched_off';
  return undefined;
}

async function ask<T>(db: Db | Tx, input: AskClaudeInput, finish: (text: string) => T): Promise<T> {
  const runtime = claudeRuntime();
  const refused = await featureRefusal(db, input.workspaceId, input.feature);
  if (refused) throw new ClaudeError(refused);
  if (!(await runtime.access.canUseClaude(db, input.workspaceId, input.userId))) {
    throw new ClaudeError('no_permission');
  }
  if (requestChars(input) > MAX_REQUEST_CHARS) throw new ClaudeError('too_long');
  const now = runtime.now();
  const used = await requestsThisMonth(db, input.workspaceId, now);
  const limit = monthlyLimitFrom(
    await getWorkspaceSetting(db, input.workspaceId, CLAUDE_MONTHLY_LIMIT_KEY),
    runtime.settings().monthlyRequests,
  );
  if (used >= limit) throw new ClaudeError('monthly_cap');
  const since = new Date(now.getTime() - PERSON_WINDOW_MS);
  if ((await requestsSince(db, input.userId, since)) >= PERSON_REQUESTS) {
    throw new ClaudeError('user_rate_limit');
  }

  const usage = { workspaceId: input.workspaceId, userId: input.userId, feature: input.feature };
  let reply: ClaudeReply;
  try {
    reply = await sendToClaude(runtime, {
      ...buildPrompt(input),
      maxTokens: maxTokens(input.maxTokens),
    });
  } catch (error) {
    await recordUsage(db, {
      ...usage,
      status: claudeErrorReason(error) ?? 'unavailable',
      createdAt: now,
    });
    throw error;
  }

  const tokens = { inputTokens: reply.inputTokens, outputTokens: reply.outputTokens };
  let result: T;
  try {
    if (!reply.text) throw new ClaudeError('bad_output');
    result = finish(reply.text);
  } catch (error) {
    const status = claudeErrorReason(error) ?? 'bad_output';
    await recordUsage(db, { ...usage, ...tokens, status, createdAt: now });
    throw error;
  }
  await recordUsage(db, { ...usage, ...tokens, status: 'ok', createdAt: now });
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
