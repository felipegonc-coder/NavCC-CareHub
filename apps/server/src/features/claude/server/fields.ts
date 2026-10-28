import { randomUUID } from 'node:crypto';
import type { ClaudeErrorReason } from '@carehub/extras/claude';
import {
  CLAUDE_FIELD_ERRORS,
  CLAUDE_FIELD_LIMITS,
  claudeFieldInputProblem,
  type ClaudeFieldErrorReason,
  type ClaudeFieldFailure,
  type ClaudeFieldFillResult,
  type ClaudeFieldKind,
  type ClaudeFieldPlan,
  type ClaudeFieldRows,
  type ClaudeFieldSetup,
  type ClaudeFieldValue,
} from '@carehub/extras/claude/fields';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import { HttpError, httpError } from '../../../core/errors';
import type { Db } from '../../../db';
import { claudeFieldFills, claudeFieldQueue } from '../schema';
import { askClaude, featureRefusal } from './ask';
import { ClaudeError, claudeErrorReason } from './errors';
import { claudeFieldHost, type ClaudeField, type ClaudeRowText } from './fields-host';
import { MAX_REQUEST_CHARS, type ClaudeDocument } from './prompt';
import { claudeRuntime } from './runtime';

/** A few sentences or 5 points never need more. */
const FIELD_MAX_TOKENS = 600;
/** Room left for the instruction and the markers around each property. */
const MARGIN = 2_000;
const HOUR_MS = 60 * 60_000;
/** Refused before anything was sent. Every other reason means a request went out and failed. */
const REFUSALS: ReadonlySet<ClaudeErrorReason> = new Set([
  'not_set_up',
  'not_approved',
  'switched_off',
  'no_permission',
  'monthly_cap',
  'user_rate_limit',
]);

const SYSTEM = [
  "You fill in one field of a row in a customer care team's database.",
  "Use only what the row's data says. Never invent names, dates or facts.",
  'Write plain text: no Markdown, HTML, links or images.',
].join(' ');

function instructionFor(setup: ClaudeFieldSetup): string {
  if (setup.kind === 'summary') return 'Summarize this row in at most 3 short sentences.';
  if (setup.kind === 'key_points') {
    return 'Write the key points of this row: at most 5, one short line each.';
  }
  return `The field's instructions: ${setup.instructions}\nFollow them for this row, briefly.`;
}

export interface FillClaudeFieldsInput {
  userId: string;
  databaseId: string;
  propertyId: string;
  rowIds: ClaudeFieldRows;
  /** With more than one row: the count the person said yes to ("Fill 240 rows?"). */
  confirmedRows?: number | undefined;
}

type FillTarget = Omit<FillClaudeFieldsInput, 'confirmedRows'>;

/**
 * Fills a Claude field By hand. One row fills now and comes back. More rows need `confirmedRows`,
 * the count planClaudeFieldFill gave, and fill in the background, 5 at a time.
 */
export async function fillClaudeFields(
  db: Db,
  input: FillClaudeFieldsInput,
): Promise<ClaudeFieldFillResult> {
  const { userId } = input;
  const { field, rowIds } = await fillableRows(db, input);
  if (typeof input.rowIds !== 'string' && input.rowIds.length === 1) {
    const [rowId] = rowIds;
    if (!rowId || rowId !== input.rowIds[0]) throw new ClaudeError('no_permission');
    const value = await fillRow(db, field, rowId, { userId, auto: false, background: false });
    return { status: 'filled', rowId, value };
  }
  if (input.confirmedRows !== rowIds.length) {
    throw fieldError('rows_changed', { rows: rowIds.length });
  }
  if (rowIds.length > 0) {
    const { workspaceId, databaseId, propertyId } = field;
    const dueAt = claudeRuntime().now();
    const batchId = randomUUID();
    const q = claudeFieldQueue;
    await db
      .insert(q)
      .values(
        rowIds.map((rowId) => ({
          workspaceId,
          databaseId,
          propertyId,
          rowId,
          auto: false,
          requestedBy: userId,
          dueAt,
          batchId,
        })),
      )
      .onConflictDoUpdate({
        target: [q.databaseId, q.propertyId, q.rowId],
        // A By-hand fill takes over from an automatic one waiting for the same row.
        set: {
          auto: false,
          requestedBy: userId,
          dueAt,
          attempts: 0,
          version: sql`${q.version} + 1`,
          batchId,
          failedReason: null,
        },
      });
  }
  return { status: 'queued', rows: rowIds.length };
}

/** The count for the confirm before a Fill of more than one row, and this month's cap. */
export async function planClaudeFieldFill(db: Db, input: FillTarget): Promise<ClaudeFieldPlan> {
  const { rowIds } = await fillableRows(db, input);
  return { rows: rowIds.length, monthlyRequests: claudeRuntime().settings().monthlyRequests };
}

/** The field, checked for the person, and the rows of the request they may fill now. */
async function fillableRows(db: Db, input: FillTarget) {
  const { userId, databaseId, propertyId } = input;
  const field = await claudeFieldHost().field(db, databaseId, propertyId);
  if (!field) throw new ClaudeError('no_permission');
  await checkField(db, field, userId);
  const rowIds = await claudeFieldHost().fillableRows(db, {
    userId,
    databaseId,
    propertyId,
    rowIds: input.rowIds,
    limit: CLAUDE_FIELD_LIMITS.rows,
  });
  // Rows the person can't edit are left out; asking only for those is refused.
  if (rowIds.length === 0 && typeof input.rowIds !== 'string') {
    throw new ClaudeError('no_permission');
  }
  return { field, rowIds: rowIds.slice(0, CLAUDE_FIELD_LIMITS.rows) };
}

/**
 * Throws unless the person may fill the field now: claude.use first (so nobody outside the
 * workspace learns more), then the key, the OK and the switch, then inputs that everyone who sees
 * the field may see.
 */
export async function checkField(db: Db, field: ClaudeField, userId: string): Promise<void> {
  if (!(await claudeRuntime().access.canUseClaude(db, field.workspaceId, userId))) {
    throw new ClaudeError('no_permission');
  }
  const refused = await featureRefusal(db, field.workspaceId, 'fields');
  if (refused) throw new ClaudeError(refused);
  const problem = claudeFieldInputProblem(field, field.inputs);
  if (problem) throw fieldError(problem);
}

export interface Filler {
  userId: string;
  /** Automatically, with the owner's access, rather than By hand for userId. */
  auto: boolean;
  /** From the queue: nobody is waiting, so it doesn't count toward the person's limit. */
  background: boolean;
}

/**
 * Asks Claude for one row's value, as `by.userId` reads the row, and saves it. When a request was
 * sent and failed, the row keeps its old text, is marked failed with the reason (in the background,
 * by the queue) and the error is thrown.
 */
export async function fillRow(
  db: Db,
  field: ClaudeField,
  rowId: string,
  by: Filler,
): Promise<ClaudeFieldValue> {
  const host = claudeFieldHost();
  const now = claudeRuntime().now();
  const { workspaceId, databaseId, propertyId } = field;
  const [used] = await db
    .select({ n: count() })
    .from(claudeFieldFills)
    .where(
      and(
        eq(claudeFieldFills.databaseId, databaseId),
        gte(claudeFieldFills.createdAt, new Date(now.getTime() - HOUR_MS)),
      ),
    );
  if ((used?.n ?? 0) >= CLAUDE_FIELD_LIMITS.perDatabaseHour) throw fieldError('database_hour');

  const row = await host.readRowText(db, {
    userId: by.userId,
    rowId,
    propertyIds: field.inputs.map((input) => input.id),
    content: field.setup.usesPageContent,
  });
  if (!row) throw new ClaudeError('no_permission');
  const save = (value: ClaudeFieldValue | null, reason?: ClaudeFieldFailure) =>
    host.saveFill(db, { databaseId, propertyId, rowId, userId: by.userId, value, reason });
  const record = (status: 'ok' | 'failed') =>
    db.insert(claudeFieldFills).values({
      workspaceId,
      databaseId,
      propertyId,
      userId: by.userId,
      auto: by.auto,
      status,
      createdAt: now,
    });

  let text = '';
  const documents = rowDocuments(row);
  // A row with nothing to read fills empty, without a request.
  if (documents.length > 0) {
    try {
      ({ text } = await askClaude(db, {
        workspaceId,
        userId: by.userId,
        feature: 'fields',
        system: SYSTEM,
        instruction: instructionFor(field.setup),
        documents,
        maxTokens: FIELD_MAX_TOKENS,
        background: by.background,
      }));
    } catch (error) {
      const reason = claudeErrorReason(error);
      if (reason && !REFUSALS.has(reason)) {
        await record('failed');
        if (!by.background) await save(null, reason);
      }
      throw error;
    }
    await record('ok');
  }
  const value: ClaudeFieldValue = {
    text: cleanAnswer(text, field.setup.kind),
    filledAt: now.toISOString(),
    filledFor: by.auto ? null : by.userId,
    status: 'filled',
  };
  await save(value);
  return value;
}

/** The used properties, then the page content, cut so the request stays within its size. */
function rowDocuments(row: ClaudeRowText): ClaudeDocument[] {
  const all = row.properties.map((property) => ({
    title: property.name,
    text: property.text.trim().slice(0, CLAUDE_FIELD_LIMITS.value),
  }));
  if (row.content !== undefined) {
    const text = row.content.trim().slice(0, CLAUDE_FIELD_LIMITS.pageContent);
    all.push({ title: 'Page content', text });
  }
  let room = MAX_REQUEST_CHARS - MARGIN;
  const documents: ClaudeDocument[] = [];
  for (const document of all) {
    const text = document.text.slice(0, Math.max(0, room - document.title.length));
    if (!text) continue;
    documents.push({ title: document.title, text });
    room -= document.title.length + text.length;
  }
  return documents;
}

/** Claude's answer as a value: plain lines, at most 5 for Key points, cut to a Text's size. */
export function cleanAnswer(text: string, kind: ClaudeFieldKind): string {
  let lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*#+\s+/, '')
        .replaceAll('**', '')
        .trimEnd(),
    );
  if (kind === 'key_points') {
    lines = lines
      .filter((line) => line.trim())
      .slice(0, 5)
      .map((line) => `• ${line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')}`);
  }
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, CLAUDE_FIELD_LIMITS.value);
}

/** CLAUDE_FIELD_ERRORS[reason] as the routes answer it, with `details: { reason, ...more }`. */
export function fieldError(
  reason: ClaudeFieldErrorReason,
  more: Record<string, unknown> = {},
): HttpError {
  const { status, code, message } = CLAUDE_FIELD_ERRORS[reason];
  return httpError(status, code, message, { reason, ...more });
}

/** The reason of an error fieldError made, or undefined for any other error. */
export function fieldErrorReason(error: unknown): ClaudeFieldErrorReason | undefined {
  if (!(error instanceof HttpError)) return undefined;
  const reason: unknown = (error.details as { reason?: unknown } | undefined)?.reason;
  return typeof reason === 'string' && Object.hasOwn(CLAUDE_FIELD_ERRORS, reason)
    ? (reason as ClaudeFieldErrorReason)
    : undefined;
}
