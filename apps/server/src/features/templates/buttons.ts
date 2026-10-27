// Button blocks ("/button", Templates and buttons spec 3.4): settings, pressing (with
// confirmations), Undo and the run log. Buttons act with the presser's access, never the setter's.
// Steps that change rows or send messages run here; Insert blocks, Open a page and Open a link come
// back as page steps, which the page does in order (docs/extras/testing.md).
import {
  BUTTON_LIMITS,
  BUTTON_MESSAGES,
  BUTTON_UNDO_MS,
  buttonSettingsSchema,
  DEFAULT_BUTTON,
  describeButton,
  fillBlocks,
  fillMessage,
  nextConfirm,
  resolveRowValues,
  settingsProblem,
  type ButtonAction,
  type ButtonResponse,
  type ButtonRunEntry,
  type ButtonSettings,
  type PageStep,
  type PressContext,
  type PressResponse,
  type UndoResponse,
} from '@carehub/extras/templates/buttons';
import { isSafeWebLink } from '@carehub/databases/richtext';
import { atLeast, type AccessLevel } from '@carehub/shared';
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { HttpError, httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { users } from '../auth/schema';
import { core, type CorePage, type TemplatesViewer } from './core';
import {
  tplButtonRuns,
  tplButtons,
  type ButtonRow,
  type ButtonRunChange,
  type ButtonRunRow,
} from './schema';

/** Network time on top of the 8 seconds "Done · Undo" shows. */
const UNDO_GRACE_MS = 4000;
/** How long a run waits at a confirmation. */
const PAUSE_MS = 30 * 60 * 1000;

const notFound = () => httpError(404, 'not_found');
const refuse = (message: string) => httpError(403, 'forbidden', message);

type Found = { page: CorePage; level: AccessLevel };

/** The page, for someone who can at least view it. */
async function pageFor(db: Db | Tx, viewer: TemplatesViewer, pageId: string): Promise<Found> {
  const found = await core().page(db, viewer.userId, pageId);
  if (!found || found.page.workspaceId !== viewer.workspaceId) throw notFound();
  if (!atLeast(found.level, 'view')) throw notFound();
  return found;
}

function settingsOf(row: ButtonRow): ButtonSettings {
  return { label: row.label, icon: row.icon, color: row.color, who: row.who, actions: row.actions };
}

const copyOf = (row: ButtonRow) => ({
  workspaceId: row.workspaceId,
  label: row.label,
  icon: row.icon,
  color: row.color,
  who: row.who,
  actions: row.actions,
  setByAdmin: row.setByAdmin,
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
});

/**
 * The button for this page: its own, or, on a page copied with Duplicate (whose block still has
 * the first page's button ID), a copy of its own made now, for someone who can open the first page.
 */
async function buttonFor(
  db: Db | Tx,
  viewer: TemplatesViewer,
  id: string,
  pageId: string,
): Promise<ButtonRow> {
  const [row] = await db
    .select()
    .from(tplButtons)
    .where(and(eq(tplButtons.id, id), eq(tplButtons.workspaceId, viewer.workspaceId)));
  if (!row) throw notFound();
  if (row.pageId === pageId) return row;
  const ownCopy = () =>
    db
      .select()
      .from(tplButtons)
      .where(and(eq(tplButtons.copiedFrom, row.id), eq(tplButtons.pageId, pageId)));
  const [copy] = await ownCopy();
  if (copy) return copy;
  if (!row.pageId) throw notFound();
  const levels = await core().levels(db, viewer.userId, [row.pageId]);
  if (!atLeast(levels.get(row.pageId) ?? 'none', 'view')) throw notFound();
  const [made] = await db
    .insert(tplButtons)
    .values({ ...copyOf(row), pageId, copiedFrom: row.id })
    .onConflictDoNothing()
    .returning();
  const result = made ?? (await ownCopy())[0];
  if (!result) throw notFound();
  return result;
}

/** Why this person can't press it now, or null. */
function whyNot(row: ButtonRow, found: Found): string | null {
  if (found.page.archived) return BUTTON_MESSAGES.archived;
  if (row.who === 'editors' && !atLeast(found.level, 'edit')) return BUTTON_MESSAGES.editorsOnly;
  if (row.actions.length === 0) return BUTTON_MESSAGES.noActions;
  return null;
}

const canEditButton = (found: Found) => atLeast(found.level, 'edit') && !found.page.locked;

async function runLog(db: Db | Tx, buttonId: string): Promise<ButtonRunEntry[]> {
  const rows = await db
    .select({ run: tplButtonRuns, userName: users.name })
    .from(tplButtonRuns)
    .leftJoin(users, eq(users.id, tplButtonRuns.userId))
    .where(eq(tplButtonRuns.buttonId, buttonId))
    .orderBy(desc(tplButtonRuns.startedAt))
    .limit(BUTTON_LIMITS.runs);
  return rows.map(({ run, userName }) => ({
    id: run.id,
    userName: userName ?? 'Someone',
    at: run.startedAt.toISOString(),
    status: run.status,
    failedStep: run.failedStep,
    reason: run.reason,
  }));
}

async function respond(
  db: Db | Tx,
  row: ButtonRow,
  found: Found,
  pageId: string,
): Promise<ButtonResponse> {
  const settings = settingsOf(row);
  const reason = whyNot(row, found);
  const canEdit = canEditButton(found);
  return {
    id: row.id,
    pageId,
    settings,
    sentence: describeButton(settings),
    canEdit,
    canPress: reason === null,
    reason,
    runs: canEdit ? await runLog(db, row.id) : [],
  };
}

/** GET /api/templates/buttons/:id?pageId= */
export async function getButton(
  db: Db,
  viewer: TemplatesViewer,
  id: string,
  pageId: string,
): Promise<ButtonResponse> {
  const found = await pageFor(db, viewer, pageId);
  const row = await buttonFor(db, viewer, id, pageId);
  return respond(db, row, found, pageId);
}

/**
 * Checks the settings for this person and keeps the names the sentence shows: each database or
 * page as they see it (they must be able to open it).
 */
async function prepareSettings(
  db: Db | Tx,
  viewer: TemplatesViewer,
  input: unknown,
  previous: ButtonRow | null,
): Promise<{ settings: ButtonSettings; setByAdmin: boolean }> {
  const settings = buttonSettingsSchema.parse(input);
  const audiences = (list: readonly ButtonAction[]) =>
    list.flatMap((action) =>
      action.kind === 'send_message' && (action.to.everyone || action.to.roleIds.length)
        ? [JSON.stringify([action.to.everyone, [...action.to.roleIds].sort()])]
        : [],
    );
  // Someone who isn't an Admin may change a button an Admin set up, as long as it reaches no
  // more of Everyone or the roles than before.
  const kept = new Set(previous?.setByAdmin ? audiences(previous.actions) : []);
  const widens = audiences(settings.actions).some((audience) => !kept.has(audience));
  const problem = settingsProblem(settings, { isAdmin: viewer.isAdmin || !widens });
  if (problem) throw httpError(400, 'invalid', problem);
  for (const action of settings.actions) {
    if (action.kind !== 'add_row' && action.kind !== 'edit_rows' && action.kind !== 'open_page') {
      continue;
    }
    const targetId = action.kind === 'open_page' ? action.pageId : action.databaseId;
    if (!targetId) continue;
    const target = await core().page(db, viewer.userId, targetId);
    const database = action.kind !== 'open_page';
    const visible =
      target &&
      target.page.workspaceId === viewer.workspaceId &&
      atLeast(target.level, 'view') &&
      (!database || target.page.kind === 'database');
    if (!visible) {
      throw httpError(
        400,
        'invalid',
        database ? 'Pick a database you can open.' : 'Pick a page you can open.',
      );
    }
    action.names = { ...action.names, target: target.page.title || 'Untitled' };
  }
  const anyAudience = audiences(settings.actions).length > 0;
  return {
    settings,
    setByAdmin: anyAudience && (viewer.isAdmin || Boolean(previous?.setByAdmin)),
  };
}

/** POST /api/templates/buttons: a new button block. Needs Can edit on the page. */
export async function createButton(
  db: Db,
  viewer: TemplatesViewer,
  input: { pageId: string; settings: Partial<ButtonSettings> },
): Promise<ButtonResponse> {
  const found = await pageFor(db, viewer, input.pageId);
  if (!atLeast(found.level, 'edit')) throw httpError(403, 'forbidden');
  if (found.page.locked) throw httpError(409, 'conflict', BUTTON_MESSAGES.locked);
  const { settings, setByAdmin } = await prepareSettings(
    db,
    viewer,
    { ...DEFAULT_BUTTON, ...input.settings },
    null,
  );
  const [row] = await db
    .insert(tplButtons)
    .values({
      workspaceId: viewer.workspaceId,
      pageId: input.pageId,
      ...settings,
      setByAdmin,
      createdBy: viewer.userId,
      updatedBy: viewer.userId,
    })
    .returning();
  if (!row) throw new Error('The button was not saved.');
  return respond(db, row, found, input.pageId);
}

/** PUT /api/templates/buttons/:id: Edit button. Needs Can edit on the page. */
export async function updateButton(
  db: Db,
  viewer: TemplatesViewer,
  id: string,
  input: { pageId: string; settings: unknown },
): Promise<ButtonResponse> {
  const found = await pageFor(db, viewer, input.pageId);
  const row = await buttonFor(db, viewer, id, input.pageId);
  if (!atLeast(found.level, 'edit')) throw httpError(403, 'forbidden');
  if (found.page.locked) throw httpError(409, 'conflict', BUTTON_MESSAGES.locked);
  const { settings, setByAdmin } = await prepareSettings(db, viewer, input.settings, row);
  const [saved] = await db
    .update(tplButtons)
    .set({ ...settings, setByAdmin, updatedBy: viewer.userId, updatedAt: new Date() })
    .where(eq(tplButtons.id, row.id))
    .returning();
  if (!saved) throw notFound();
  return respond(db, saved, found, input.pageId);
}

// ---------------------------------------------------------------- copies

const BLOCK = /<!--\s*carehub:block\s+(\{[\s\S]*?\})\s*-->/g;
const UUID_IN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The button IDs in a page's Markdown (the collab feature's placeholders). */
export function buttonIdsIn(markdown: string): string[] {
  const ids = new Set<string>();
  for (const [, json] of markdown.matchAll(BLOCK)) {
    try {
      const node = JSON.parse(json ?? '') as { type?: unknown; attrs?: { buttonId?: unknown } };
      const id = node.attrs?.buttonId;
      if (node.type === 'actionButton' && typeof id === 'string' && UUID_IN.test(id)) {
        ids.add(id.toLowerCase());
      }
    } catch {
      // Not JSON: not a button.
    }
  }
  return [...ids];
}

/**
 * New copies of the buttons in some Markdown, for a template (Save as template) or a new page
 * (Use template), and the Markdown pointing at them. Only the buttons of `from` (the pages being
 * saved, or the template being used) are copied; other blocks lose their button ID and show
 * "This button was removed."
 */
export async function copyButtons(
  tx: Tx,
  markdown: string,
  to: { workspaceId: string; pageId: string | null; templateId: string | null; by: string },
  from: { pageIds?: ReadonlySet<string>; templateId?: string | null },
): Promise<string> {
  const ids = buttonIdsIn(markdown);
  if (ids.length === 0) return markdown;
  const rows = await tx
    .select()
    .from(tplButtons)
    .where(and(inArray(tplButtons.id, ids), eq(tplButtons.workspaceId, to.workspaceId)));
  const copies = new Map<string, string>();
  for (const row of rows) {
    const fromTemplate = Boolean(from.templateId) && row.templateId === from.templateId;
    const fromPage = row.pageId !== null && Boolean(from.pageIds?.has(row.pageId.toLowerCase()));
    if (!fromTemplate && !fromPage) continue;
    const [copy] = await tx
      .insert(tplButtons)
      .values({
        ...copyOf(row),
        pageId: to.pageId,
        templateId: to.templateId,
        updatedBy: to.by,
      })
      .returning({ id: tplButtons.id });
    if (copy) copies.set(row.id.toLowerCase(), copy.id);
  }
  return markdown.replace(BLOCK, (whole, json: string) => {
    const id = buttonIdsIn(whole)[0];
    if (!id) return whole;
    const copy = copies.get(id) ?? '';
    const node = JSON.parse(json) as { attrs?: Record<string, unknown> };
    // The JSON never holds `--` here: a button block's only attribute is its ID.
    return `<!-- carehub:block ${JSON.stringify({ ...node, attrs: { ...node.attrs, buttonId: copy || null } })} -->`;
  });
}

// ---------------------------------------------------------------- pressing

/** A step refused before anything changed: 403 with the reason, and nothing happens. */
class Refused extends Error {
  constructor(
    readonly step: number,
    message: string,
  ) {
    super(message);
  }
}

const stepTarget = (action: ButtonAction) =>
  ('names' in action && action.names?.target) || 'the database';

/** What a row function's error means for the run: a refusal, a failure, or a real error. */
function readRowError(error: unknown, step: number, action: ButtonAction): Refused | string {
  if (!(error instanceof HttpError)) throw error;
  if (error.statusCode === 403) {
    return new Refused(
      step,
      action.kind === 'add_row'
        ? `You can't add rows to ${stepTarget(action)}.`
        : `You can't edit rows in ${stepTarget(action)}.`,
    );
  }
  if (error.statusCode === 404) return `${stepTarget(action)} is in Trash.`;
  if (error.statusCode === 400) return error.message;
  throw error;
}

/** The same values, whatever the order of their keys. */
function sameValues(a: Record<string, unknown>, b: Record<string, unknown>, keys: string[]) {
  const stable = (value: unknown): string =>
    JSON.stringify(value ?? null, (_key, item: unknown) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(
            Object.entries(item as Record<string, unknown>).sort(([x], [y]) =>
              x < y ? -1 : x > y ? 1 : 0,
            ),
          )
        : item,
    );
  return keys.every((key) => stable(a[key]) === stable(b[key]));
}

const pick = (values: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.map((key) => [key, values[key] ?? null]));

/** Checks what can be checked before anything runs (spec 3.4): pages, links and messages. */
async function precheck(
  db: Db,
  viewer: TemplatesViewer,
  row: ButtonRow,
  found: Found,
  from: number,
): Promise<Map<number, string[]>> {
  const recipients = new Map<number, string[]>();
  for (let index = from; index < row.actions.length; index += 1) {
    const action = row.actions[index] as ButtonAction;
    switch (action.kind) {
      case 'insert_blocks':
        if (!atLeast(found.level, 'edit')) throw new Refused(index, BUTTON_MESSAGES.cantEditPage);
        if (found.page.locked) throw new Refused(index, BUTTON_MESSAGES.locked);
        break;
      case 'open_page': {
        if (!action.pageId) break;
        const levels = await core().levels(db, viewer.userId, [action.pageId]);
        if (!atLeast(levels.get(action.pageId) ?? 'none', 'view')) {
          throw new Refused(index, `You can't open ${action.names?.target || 'that page'}.`);
        }
        break;
      }
      case 'open_link':
        if (!isSafeWebLink(action.url)) throw new Refused(index, BUTTON_MESSAGES.badLink);
        break;
      case 'send_message': {
        if ((action.to.everyone || action.to.roleIds.length) && !row.setByAdmin) {
          throw new Refused(index, BUTTON_MESSAGES.adminsOnly);
        }
        const people = await core().recipients(db, viewer.workspaceId, action.to);
        if (people.length > BUTTON_LIMITS.people) {
          throw new Refused(index, BUTTON_MESSAGES.tooManyPeople);
        }
        if (people.length === 0) throw new Refused(index, BUTTON_MESSAGES.noOne);
        recipients.set(index, people);
        break;
      }
      default:
        break;
    }
  }
  return recipients;
}

type Outbox = { step: number; userIds: string[]; text: string; cardPageId: string };

/** POST /api/templates/buttons/:id/press: runs the steps up to the next confirmation. */
export async function pressButton(
  app: FastifyInstance,
  viewer: TemplatesViewer,
  id: string,
  input: { pageId: string; runId?: string; from: number },
): Promise<PressResponse> {
  const db = app.db;
  const found = await pageFor(db, viewer, input.pageId);
  const row = await buttonFor(db, viewer, id, input.pageId);
  const reason = whyNot(row, found);
  if (reason) throw refuse(reason);

  let run: ButtonRunRow | null = null;
  if (input.runId) {
    const [paused] = await db
      .select()
      .from(tplButtonRuns)
      .where(
        and(
          eq(tplButtonRuns.id, input.runId),
          eq(tplButtonRuns.buttonId, row.id),
          eq(tplButtonRuns.userId, viewer.userId),
        ),
      );
    const stale =
      !paused ||
      paused.status !== 'paused' ||
      paused.nextStep !== input.from ||
      Date.now() - paused.startedAt.getTime() > PAUSE_MS ||
      row.actions[input.from - 1]?.kind !== 'confirm';
    if (stale) throw httpError(409, 'conflict', 'This button changed. Press it again.');
    run = paused;
  } else if (input.from !== 0) {
    throw httpError(400, 'invalid', 'Press the button to start from the first step.');
  }

  const from = input.from;
  const confirmAt = nextConfirm(row.actions, from);
  const end = confirmAt === -1 ? row.actions.length : confirmAt;
  const ctx: PressContext = {
    userId: viewer.userId,
    name: viewer.name,
    timeZone: viewer.timeZone,
    use24h: viewer.use24h,
    page: { id: found.page.id, title: found.page.title },
    now: new Date(),
  };

  const logRefusal = async (refusal: Refused) => {
    const values = {
      status: 'refused' as const,
      nextStep: null,
      failedStep: refusal.step + 1,
      reason: refusal.message,
      finishedAt: new Date(),
    };
    if (run) await db.update(tplButtonRuns).set(values).where(eq(tplButtonRuns.id, run.id));
    else
      await db.insert(tplButtonRuns).values({ buttonId: row.id, userId: viewer.userId, ...values });
    await trimRuns(db, row.id);
  };

  let recipients: Map<number, string[]>;
  try {
    recipients = await precheck(db, viewer, row, found, from);
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    await logRefusal(error);
    throw refuse(error.message);
  }

  const changes: ButtonRunChange[] = [...(run?.changes ?? [])];
  const pageSteps: PageStep[] = [];
  const outbox: Outbox[] = [];
  let failure: { step: number; message: string } | null = null;
  let skipped = 0;
  const lastRowId = () => {
    for (let index = changes.length - 1; index >= 0; index -= 1) {
      const change = changes[index];
      if (change?.kind === 'row_added') return change.rowId;
    }
    return null;
  };

  let saved: ButtonRunRow;
  try {
    saved = await core().runRowWrites(app, async (tx) => {
      for (let index = from; index < end && !failure; index += 1) {
        const action = row.actions[index] as ButtonAction;
        const fail = (message: string) => {
          failure = { step: index + 1, message: `Couldn't finish step ${index + 1}: ${message}` };
        };
        switch (action.kind) {
          case 'insert_blocks':
            pageSteps.push({
              index,
              kind: 'insert_blocks',
              where: action.where,
              blocks: fillBlocks(action.blocks, ctx),
            });
            break;
          case 'open_page': {
            const pageId = action.pageId ?? lastRowId();
            if (pageId) pageSteps.push({ index, kind: 'open_page', pageId, openIn: action.openIn });
            break;
          }
          case 'open_link':
            pageSteps.push({ index, kind: 'open_link', url: action.url });
            break;
          case 'add_row': {
            const values = resolveRowValues(action.values, ctx);
            try {
              const { rowId } = await core().createRow(tx, {
                databaseId: action.databaseId,
                ...(action.templateId ? { templateId: action.templateId } : {}),
                values,
                actorUserId: viewer.userId,
                source: 'button',
              });
              const keys = Object.keys(values);
              const read = await core().readRow(tx, { userId: viewer.userId, rowId });
              changes.push({
                kind: 'row_added',
                step: index,
                databaseId: action.databaseId,
                rowId,
                after: pick(read?.values ?? values, keys),
              });
            } catch (error) {
              const result = readRowError(error, index, action);
              if (result instanceof Refused) throw result;
              fail(result);
            }
            break;
          }
          case 'edit_rows': {
            const values = resolveRowValues(action.values, ctx);
            const keys = Object.keys(values);
            try {
              const matches = await core().findRowIds(tx, {
                userId: viewer.userId,
                databaseId: action.databaseId,
                filter: action.filter ?? null,
                limit: BUTTON_LIMITS.rows + 1,
              });
              if (matches.length > BUTTON_LIMITS.rows) {
                fail(`more than ${BUTTON_LIMITS.rows} rows match. Narrow the filter.`);
                break;
              }
              const editable = matches.filter((item) => atLeast(item.access, 'edit_content'));
              skipped += matches.length - editable.length;
              if (editable.length === 0 || keys.length === 0) break;
              const before: Record<string, Record<string, unknown>> = {};
              for (const { rowId } of editable) {
                const read = await core().readRow(tx, { userId: viewer.userId, rowId });
                before[rowId] = pick(read?.values ?? {}, keys);
              }
              await core().updateRows(tx, {
                databaseId: action.databaseId,
                rowIds: editable.map((item) => item.rowId),
                values,
                actorUserId: viewer.userId,
                source: 'button',
              });
              const rows = [];
              for (const { rowId } of editable) {
                const read = await core().readRow(tx, { userId: viewer.userId, rowId });
                rows.push({
                  rowId,
                  before: before[rowId] ?? {},
                  after: pick(read?.values ?? values, keys),
                });
              }
              changes.push({
                kind: 'rows_edited',
                step: index,
                databaseId: action.databaseId,
                rows,
              });
            } catch (error) {
              const result = readRowError(error, index, action);
              if (result instanceof Refused) throw result;
              fail(result);
            }
            break;
          }
          case 'send_message': {
            const userIds = recipients.get(index) ?? [];
            const cardPageId =
              action.card === 'new_row' ? (lastRowId() ?? found.page.id) : found.page.id;
            outbox.push({
              step: index,
              userIds,
              text: fillMessage(action.message, ctx),
              cardPageId,
            });
            changes.push({ kind: 'messages_sent', step: index, count: userIds.length });
            break;
          }
          case 'confirm':
            break;
        }
      }
      const paused = !failure && confirmAt !== -1;
      const stopped = failure as { step: number; message: string } | null;
      const values = {
        status: stopped ? ('failed' as const) : paused ? ('paused' as const) : ('done' as const),
        nextStep: paused ? confirmAt + 1 : null,
        failedStep: stopped?.step ?? null,
        reason: stopped?.message ?? null,
        changes,
        finishedAt: paused ? null : new Date(),
      };
      const [written] = run
        ? await tx.update(tplButtonRuns).set(values).where(eq(tplButtonRuns.id, run.id)).returning()
        : await tx
            .insert(tplButtonRuns)
            .values({ buttonId: row.id, userId: viewer.userId, ...values })
            .returning();
      if (!written) throw new Error('The button run was not saved.');
      return written;
    });
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    await logRefusal(error);
    throw refuse(error.message);
  }
  await trimRuns(db, row.id);

  // Messages go out after the commit; they can't be unsent.
  let messagesSent = 0;
  for (const message of outbox) {
    for (const userId of message.userIds) {
      try {
        await core().sendNotice({
          workspaceId: viewer.workspaceId,
          userId,
          kind: 'automation',
          sender: viewer.name,
          actorUserId: viewer.userId,
          icon: row.icon ?? '🔘',
          title: 'Message from a button',
          text: message.text,
          card: { type: 'page', pageId: message.cardPageId },
        });
        messagesSent += 1;
      } catch (error) {
        app.log.warn({ err: error, buttonId: row.id }, 'A button message was not sent');
      }
    }
  }

  const confirmStep = saved.status === 'paused' ? row.actions[confirmAt] : undefined;
  const changed =
    saved.changes.length > 0 || pageSteps.some((step) => step.kind === 'insert_blocks');
  return {
    runId: saved.id,
    pageSteps,
    failure:
      saved.status === 'failed'
        ? { step: saved.failedStep ?? 0, message: saved.reason ?? '' }
        : null,
    confirm:
      confirmStep?.kind === 'confirm'
        ? {
            from: confirmAt + 1,
            title: confirmStep.title,
            message: confirmStep.message,
            confirmLabel: confirmStep.confirmLabel,
          }
        : null,
    changed,
    messagesSent,
    skipped,
    undoUntil:
      saved.finishedAt && changed
        ? new Date(saved.finishedAt.getTime() + BUTTON_UNDO_MS).toISOString()
        : null,
  };
}

/** Keeps each button's last 50 runs. */
async function trimRuns(db: Db | Tx, buttonId: string) {
  const keep = db
    .select({ id: tplButtonRuns.id })
    .from(tplButtonRuns)
    .where(eq(tplButtonRuns.buttonId, buttonId))
    .orderBy(desc(tplButtonRuns.startedAt))
    .limit(BUTTON_LIMITS.runs);
  await db
    .delete(tplButtonRuns)
    .where(and(eq(tplButtonRuns.buttonId, buttonId), notInArray(tplButtonRuns.id, keep)));
}

async function ownRun(db: Db | Tx, viewer: TemplatesViewer, runId: string) {
  const [run] = await db
    .select({ run: tplButtonRuns })
    .from(tplButtonRuns)
    .innerJoin(tplButtons, eq(tplButtons.id, tplButtonRuns.buttonId))
    .where(
      and(
        eq(tplButtonRuns.id, runId),
        eq(tplButtonRuns.userId, viewer.userId),
        eq(tplButtons.workspaceId, viewer.workspaceId),
      ),
    );
  if (!run) throw notFound();
  return run.run;
}

/** POST /api/templates/buttons/runs/:runId/cancel: Cancel in a confirmation stops the run. */
export async function cancelRun(db: Db, viewer: TemplatesViewer, runId: string) {
  const run = await ownRun(db, viewer, runId);
  if (run.status !== 'paused') return { undoUntil: null };
  const finishedAt = new Date();
  await db
    .update(tplButtonRuns)
    .set({ status: 'cancelled', nextStep: null, finishedAt })
    .where(and(eq(tplButtonRuns.id, run.id), eq(tplButtonRuns.status, 'paused')));
  return {
    undoUntil: run.changes.length
      ? new Date(finishedAt.getTime() + BUTTON_UNDO_MS).toISOString()
      : null,
  };
}

/**
 * POST /api/templates/buttons/runs/:runId/undo, within 8 seconds: reverses the run's row changes
 * that nobody has changed since. Messages stay sent. The page undoes its own inserted blocks.
 */
export async function undoRun(
  app: FastifyInstance,
  viewer: TemplatesViewer,
  runId: string,
): Promise<UndoResponse> {
  const run = await ownRun(app.db, viewer, runId);
  const open = run.status === 'done' || run.status === 'failed' || run.status === 'cancelled';
  const recent =
    run.finishedAt !== null &&
    Date.now() - run.finishedAt.getTime() <= BUTTON_UNDO_MS + UNDO_GRACE_MS;
  if (!open || !recent) throw httpError(400, 'invalid', BUTTON_MESSAGES.undoGone);
  let kept = 0;
  let messagesSent = 0;
  await core().runRowWrites(app, async (tx) => {
    const [claimed] = await tx
      .update(tplButtonRuns)
      .set({ status: 'undone' })
      .where(and(eq(tplButtonRuns.id, run.id), sql`${tplButtonRuns.status} <> 'undone'`))
      .returning({ id: tplButtonRuns.id });
    if (!claimed) throw httpError(400, 'invalid', BUTTON_MESSAGES.undoGone);
    for (const change of [...run.changes].reverse()) {
      if (change.kind === 'messages_sent') {
        messagesSent += change.count;
        continue;
      }
      if (change.kind === 'row_added') {
        const now = await core().readRow(tx, { userId: viewer.userId, rowId: change.rowId });
        if (!now) continue;
        if (!sameValues(now.values, change.after, Object.keys(change.after))) {
          kept += 1;
          continue;
        }
        await core().trashRows(tx, {
          databaseId: change.databaseId,
          rowIds: [change.rowId],
          actorUserId: viewer.userId,
        });
        continue;
      }
      for (const edited of change.rows) {
        const now = await core().readRow(tx, { userId: viewer.userId, rowId: edited.rowId });
        if (!now || !sameValues(now.values, edited.after, Object.keys(edited.after))) {
          kept += 1;
          continue;
        }
        await core().updateRows(tx, {
          databaseId: change.databaseId,
          rowIds: [edited.rowId],
          values: edited.before,
          actorUserId: viewer.userId,
          source: 'button',
        });
      }
    }
  });
  return { kept, messagesSent };
}
