import { ME, THIS_PAGE } from '@carehub/databases/types';
import { isDynamicDate, resolveDynamicDate } from '@carehub/databases/templates';
import { isSafeWebLink } from '@carehub/databases/richtext';
import { z } from 'zod';
import { TEMPLATE_VARIABLE_NODE, TEMPLATE_VARIABLES, type TemplateVariable } from './content';
import { formatDay, formatMoment } from './variables';

// Button blocks ("/button") in pages: their settings, the plain sentence under them, the checks
// made when they're saved and pressed, and what Insert blocks puts in the page (Templates and
// buttons spec, sections 2 and 3.4). Shared by the server and the web app. Add a row and Edit rows
// use the Databases lane's stored values (decision 0200): createRow and updateRows check them.

export const BUTTON_COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export type ButtonColor = (typeof BUTTON_COLORS)[number];

export const BUTTON_LIMITS = {
  label: 100,
  actions: 10,
  /** Top-level blocks one Insert blocks step adds. */
  blocks: 200,
  /** Rows one Edit rows step changes. */
  rows: 500,
  /** People one Send a message step reaches. */
  people: 50,
  /** Runs kept per button. */
  runs: 50,
  message: 2000,
  confirmTitle: 100,
  confirmText: 500,
  confirmLabel: 30,
  url: 2000,
  /** The size of a button's settings as JSON, in characters. */
  bytes: 512 * 1024,
} as const;

/** How long "Done · Undo" stays, in milliseconds. */
export const BUTTON_UNDO_MS = 8000;

export const BUTTON_MESSAGES = {
  noActions: 'Add an action',
  editorsOnly: 'Only people who can edit this page',
  archived: "This page is archived, so its buttons can't be pressed.",
  trash: "This page is in Trash, so its buttons can't be pressed.",
  locked: 'Unlock the page first',
  cantEditPage: "You can't edit this page.",
  tooManyPeople: `A message can go to up to ${BUTTON_LIMITS.people} people.`,
  noOne: 'No one to send the message to.',
  adminsOnly: 'Only Admins can send messages to Everyone or to roles.',
  noEarlierRow: 'Add a row in an earlier step to open it.',
  badLink: 'Links must start with http:// or https://.',
  undoGone: "This can't be undone anymore.",
  undoMessages: "Messages that were sent can't be unsent.",
  undoSkipped: 'Some changes were kept because someone changed them since.',
  done: 'Done',
} as const;

/** Who can press it: people who can edit the page (the default), or everyone who can view it. */
export const BUTTON_WHO = ['editors', 'viewers'] as const;
export type ButtonWho = (typeof BUTTON_WHO)[number];

/** A block as the editor stores it (Tiptap JSON). */
export interface BlockJson {
  type: string;
  attrs?: Record<string, unknown>;
  content?: BlockJson[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

/** Names shown in the plain sentence, kept with the step when it's saved. */
export interface StepNames {
  /** The database or page the step uses, as the person who set it up saw it. */
  target?: string;
  /** Add a row: the database template's name. */
  template?: string;
  /** The values it sets: "Status New", "Assignee as the person who pressed it". */
  values?: string[];
}

export type ButtonAction =
  | { kind: 'insert_blocks'; where: 'above' | 'below'; blocks: BlockJson[] }
  | {
      kind: 'add_row';
      databaseId: string;
      templateId: string | null;
      /** Stored values by property id; a date may be Today or Now, a person list Me, a relation This page. */
      values: Record<string, unknown>;
      names?: StepNames;
    }
  | {
      kind: 'edit_rows';
      databaseId: string;
      /** A Databases FilterGroup; null for every row. */
      filter: unknown;
      values: Record<string, unknown>;
      names?: StepNames;
    }
  | {
      kind: 'open_page';
      /** null: the row made by an earlier Add a row step. */
      pageId: string | null;
      openIn: 'this_tab' | 'new_tab';
      names?: StepNames;
    }
  | { kind: 'open_link'; url: string }
  | {
      kind: 'send_message';
      to: { userIds: string[]; groupIds: string[]; roleIds: string[]; everyone: boolean };
      /** May hold {{today}}, {{now}}, {{me}} and {{this_page}}. */
      message: string;
      /** A card under the message: this page, or the row made by an earlier step. */
      card: 'this_page' | 'new_row' | null;
      names?: StepNames;
    }
  | { kind: 'confirm'; title: string; message: string; confirmLabel: string };

export type ButtonActionKind = ButtonAction['kind'];

export interface ButtonSettings {
  label: string;
  /** An emoji; null for none. */
  icon: string | null;
  color: ButtonColor;
  who: ButtonWho;
  actions: ButtonAction[];
}

export const DEFAULT_BUTTON: ButtonSettings = {
  label: 'New button',
  icon: null,
  color: 'default',
  who: 'editors',
  actions: [],
};

/** The steps that run on the server; the others run in the page. */
export const SERVER_STEPS: ReadonlySet<ButtonActionKind> = new Set([
  'add_row',
  'edit_rows',
  'send_message',
]);

// ---------------------------------------------------------------- request bodies

const id = z.uuid({ error: "That ID isn't right." });
const text = (max: number, what: string) =>
  z
    .string()
    .trim()
    .max(max, { error: `${what} can be up to ${max} characters.` });
const names = z
  .object({
    target: text(200, 'A name').optional(),
    template: text(200, 'A name').optional(),
    values: z.array(text(200, 'A value')).max(50).optional(),
  })
  .optional();
const values = z.record(z.string().min(1).max(64), z.unknown());

const block: z.ZodType<BlockJson> = z.lazy(() =>
  z.object({
    type: z.string().min(1).max(64),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(block).max(2000).optional(),
    marks: z
      .array(
        z.object({
          type: z.string().min(1).max(64),
          attrs: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .max(20)
      .optional(),
    text: z.string().max(100_000).optional(),
  }),
);

export const buttonActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('insert_blocks'),
    where: z.enum(['above', 'below']),
    blocks: z.array(block).max(BUTTON_LIMITS.blocks, {
      error: `A button can insert up to ${BUTTON_LIMITS.blocks} blocks.`,
    }),
  }),
  z.object({
    kind: z.literal('add_row'),
    databaseId: id,
    templateId: id.nullable().default(null),
    values: values.default({}),
    names,
  }),
  z.object({
    kind: z.literal('edit_rows'),
    databaseId: id,
    filter: z.unknown().default(null),
    values,
    names,
  }),
  z.object({
    kind: z.literal('open_page'),
    pageId: id.nullable(),
    openIn: z.enum(['this_tab', 'new_tab']).default('this_tab'),
    names,
  }),
  z.object({
    kind: z.literal('open_link'),
    url: text(BUTTON_LIMITS.url, 'A link').refine(isSafeWebLink, {
      error: BUTTON_MESSAGES.badLink,
    }),
  }),
  z.object({
    kind: z.literal('send_message'),
    to: z.object({
      userIds: z.array(id).max(BUTTON_LIMITS.people, { error: BUTTON_MESSAGES.tooManyPeople }),
      groupIds: z.array(id).max(20).default([]),
      roleIds: z.array(id).max(20).default([]),
      everyone: z.boolean().default(false),
    }),
    message: text(BUTTON_LIMITS.message, 'A message').min(1, { error: 'Write the message.' }),
    card: z.enum(['this_page', 'new_row']).nullable().default(null),
    names,
  }),
  z.object({
    kind: z.literal('confirm'),
    title: text(BUTTON_LIMITS.confirmTitle, 'A title').min(1, { error: 'Give it a title.' }),
    message: text(BUTTON_LIMITS.confirmText, 'The text').default(''),
    confirmLabel: text(BUTTON_LIMITS.confirmLabel, 'A button label').default('Continue'),
  }),
]);

export const buttonSettingsSchema = z.object({
  label: text(BUTTON_LIMITS.label, 'A label').min(1, { error: 'Give the button a label.' }),
  icon: z.string().trim().max(16).nullable().default(null),
  color: z.enum(BUTTON_COLORS).default('default'),
  who: z.enum(BUTTON_WHO).default('editors'),
  actions: z.array(buttonActionSchema).max(BUTTON_LIMITS.actions, {
    error: `A button can do up to ${BUTTON_LIMITS.actions} things.`,
  }),
});

/** POST /api/templates/buttons: a new button block on a page. */
export const createButtonSchema = z.object({
  pageId: id,
  settings: buttonSettingsSchema.partial().default({}),
});

/** POST /api/templates/buttons/:id/press. */
export const pressButtonSchema = z.object({
  pageId: id,
  /** Continue after a confirmation: the run and the step after the confirmation. */
  runId: id.optional(),
  from: z.number().int().min(0).max(BUTTON_LIMITS.actions).default(0),
});

// ---------------------------------------------------------------- checks

/** What's wrong with the settings for this person, or null. Run when they're saved. */
export function settingsProblem(
  settings: ButtonSettings,
  setter: { isAdmin: boolean },
): string | null {
  let rowMade = false;
  for (const action of settings.actions) {
    switch (action.kind) {
      case 'insert_blocks':
        if (action.blocks.length > BUTTON_LIMITS.blocks) {
          return `A button can insert up to ${BUTTON_LIMITS.blocks} blocks.`;
        }
        break;
      case 'add_row':
        rowMade = true;
        break;
      case 'open_page':
        if (action.pageId === null && !rowMade) return BUTTON_MESSAGES.noEarlierRow;
        break;
      case 'open_link':
        if (!isSafeWebLink(action.url)) return BUTTON_MESSAGES.badLink;
        break;
      case 'send_message':
        if ((action.to.everyone || action.to.roleIds.length > 0) && !setter.isAdmin) {
          return BUTTON_MESSAGES.adminsOnly;
        }
        if (action.card === 'new_row' && !rowMade) return BUTTON_MESSAGES.noEarlierRow;
        break;
      default:
        break;
    }
  }
  if (JSON.stringify(settings).length > BUTTON_LIMITS.bytes) {
    return 'This button is too big. Insert fewer blocks.';
  }
  return null;
}

/** The index of the first Confirm step at or after `from`, or -1. */
export function nextConfirm(actions: readonly ButtonAction[], from: number): number {
  for (let index = from; index < actions.length; index += 1) {
    if (actions[index]?.kind === 'confirm') return index;
  }
  return -1;
}

// ---------------------------------------------------------------- the plain sentence

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

function withValues(names: StepNames | undefined): string {
  const list = names?.values?.filter(Boolean) ?? [];
  if (list.length === 0) return '';
  if (list.length === 1) return ` with ${list[0]}`;
  return ` with ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function linkHost(url: string): string {
  return /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url;
}

function describeStep(
  action: ButtonAction,
  index: number,
  actions: readonly ButtonAction[],
): string {
  switch (action.kind) {
    case 'insert_blocks':
      return `insert ${plural(action.blocks.length, 'block')} ${action.where}`;
    case 'add_row': {
      const from = action.names?.template ? ` from ${action.names.template}` : '';
      return `add a row to ${action.names?.target || 'a database'}${from}${withValues(action.names)}`;
    }
    case 'edit_rows': {
      const which = action.filter ? ' that match a filter' : '';
      return `edit the rows${which} in ${action.names?.target || 'a database'}${withValues(action.names)}`;
    }
    case 'open_page': {
      const where = action.openIn === 'new_tab' ? ' in a new tab' : '';
      if (action.pageId === null) {
        const madeJustBefore = actions[index - 1]?.kind === 'add_row';
        return `open ${madeJustBefore ? 'it' : 'the new row'}${where}`;
      }
      return `open ${action.names?.target || 'a page'}${where}`;
    }
    case 'open_link':
      return `open ${linkHost(action.url)} in a new tab`;
    case 'send_message': {
      const to: string[] = [];
      if (action.to.everyone) to.push('everyone');
      if (action.to.userIds.length) to.push(plural(action.to.userIds.length, 'person', 'people'));
      if (action.to.groupIds.length) to.push(plural(action.to.groupIds.length, 'group'));
      if (action.to.roleIds.length) to.push(plural(action.to.roleIds.length, 'role'));
      return `send a message to ${to.length ? to.join(' and ') : 'no one yet'}`;
    }
    case 'confirm':
      return 'ask for confirmation';
  }
}

/**
 * "When pressed: add a row to Tickets with Status New and Assignee as the person who pressed it,
 * then open it." An empty string for a button without actions.
 */
export function describeButton(settings: Pick<ButtonSettings, 'actions'>): string {
  const steps = settings.actions.map((action, index) =>
    describeStep(action, index, settings.actions),
  );
  if (steps.length === 0) return '';
  const last = steps.pop() as string;
  const all = steps.length ? `${steps.join(', ')}, then ${last}` : last;
  return `When pressed: ${all}.`;
}

/** "Insert blocks", "Add a row" and so on: each step's name in the settings. */
export const ACTION_NAMES: Readonly<Record<ButtonActionKind, string>> = {
  insert_blocks: 'Insert blocks',
  add_row: 'Add a row',
  edit_rows: 'Edit rows',
  open_page: 'Open a page',
  open_link: 'Open a link',
  send_message: 'Send a message',
  confirm: 'Show a confirmation',
};

// ---------------------------------------------------------------- filling in on press

export interface PressContext {
  userId: string;
  name: string;
  timeZone: string;
  use24h: boolean;
  /** The page the button is on. */
  page: { id: string; title: string };
  now: Date;
}

function variableText(kind: TemplateVariable, offsetDays: number, ctx: PressContext): string {
  switch (kind) {
    case 'today':
    case 'now': {
      const value = resolveDynamicDate(
        { dynamic: kind, ...(offsetDays ? { offsetDays } : {}) },
        { timeZone: ctx.timeZone, now: ctx.now },
      );
      return kind === 'today'
        ? formatDay(value.start)
        : formatMoment(value.start, ctx.timeZone, ctx.use24h);
    }
    case 'me':
      return ctx.name;
    case 'this_page':
      return ctx.page.title || 'Untitled';
  }
}

function readChip(node: BlockJson): { kind: TemplateVariable; offsetDays: number } | null {
  if (node.type !== TEMPLATE_VARIABLE_NODE) return null;
  const kind = node.attrs?.kind;
  if (!TEMPLATE_VARIABLES.includes(kind as TemplateVariable)) return null;
  const offset = Number(node.attrs?.offsetDays ?? 0);
  return {
    kind: kind as TemplateVariable,
    offsetDays: Number.isSafeInteger(offset) ? Math.max(-3650, Math.min(3650, offset)) : 0,
  };
}

/**
 * The blocks with every variable chip filled in for the person pressing: dates and names as text,
 * This page as a link to the page. Everything else is copied as it is.
 */
export function fillBlocks(blocks: readonly BlockJson[], ctx: PressContext): BlockJson[] {
  const fill = (node: BlockJson): BlockJson => {
    const chip = readChip(node);
    if (chip) {
      const marks = node.marks ? [...node.marks] : [];
      if (chip.kind === 'this_page') {
        marks.push({ type: 'link', attrs: { href: `/p/${ctx.page.id}` } });
      }
      const text = variableText(chip.kind, chip.offsetDays, ctx);
      return marks.length ? { type: 'text', text, marks } : { type: 'text', text };
    }
    return node.content ? { ...node, content: node.content.map(fill) } : { ...node };
  };
  return blocks.map(fill);
}

/** {{today}}, {{now}}, {{me}} and {{this_page}} in a message, filled in. */
export function fillMessage(message: string, ctx: PressContext): string {
  return message.replace(/\{\{(today|now|me|this_page)\}\}/g, (_, kind: TemplateVariable) =>
    variableText(kind, 0, ctx),
  );
}

/**
 * Row values for the person pressing: Today and Now (with their offsets) become dates in their
 * time zone, Me in a list becomes them and This page becomes the page the button is on. The
 * Databases lane checks each value against its property when the row is written.
 */
export function resolveRowValues(
  values: Readonly<Record<string, unknown>>,
  ctx: Pick<PressContext, 'userId' | 'timeZone' | 'now' | 'page'>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [propertyId, value] of Object.entries(values)) {
    if (isDynamicDate(value)) {
      out[propertyId] = resolveDynamicDate(value, { timeZone: ctx.timeZone, now: ctx.now });
    } else if (Array.isArray(value)) {
      const ids = value.map((item: unknown) =>
        item === ME ? ctx.userId : item === THIS_PAGE ? ctx.page.id : item,
      );
      out[propertyId] = [...new Set(ids)];
    } else {
      out[propertyId] =
        value === null || typeof value !== 'object'
          ? value
          : (JSON.parse(JSON.stringify(value)) as unknown);
    }
  }
  return out;
}

// ---------------------------------------------------------------- answers

export interface ButtonRunEntry {
  id: string;
  userName: string;
  at: string;
  status: 'done' | 'failed' | 'refused' | 'cancelled' | 'undone' | 'paused';
  /** 1-based, for "Failed at step 2". */
  failedStep: number | null;
  reason: string | null;
}

/** GET /api/templates/buttons/:id?pageId= */
export interface ButtonResponse {
  /** The button's ID for this page (a copied page gets its own). */
  id: string;
  pageId: string;
  settings: ButtonSettings;
  sentence: string;
  canEdit: boolean;
  /** Whether this person can press it now; `reason` says why not. */
  canPress: boolean;
  reason: string | null;
  /** The last runs, for people who can edit it; [] for everyone else. */
  runs: ButtonRunEntry[];
}

/** A step the page does itself, in order, after the server's steps before it. */
export type PageStep =
  | { index: number; kind: 'insert_blocks'; where: 'above' | 'below'; blocks: BlockJson[] }
  | { index: number; kind: 'open_page'; pageId: string; openIn: 'this_tab' | 'new_tab' }
  | { index: number; kind: 'open_link'; url: string };

/** POST /api/templates/buttons/:id/press */
export interface PressResponse {
  runId: string;
  /** What the page does, in order: only steps before a failure or confirmation. */
  pageSteps: PageStep[];
  /** Set when a step failed: later steps didn't run. */
  failure: { step: number; message: string } | null;
  /** Set when a confirmation comes next: Continue presses again with `from`. */
  confirm: { from: number; title: string; message: string; confirmLabel: string } | null;
  /** Whether the run changed anything (for "Done · Undo"). */
  changed: boolean;
  /** Messages went out: Undo can't take them back. */
  messagesSent: number;
  /** Edit rows: rows the presser can't edit, left as they were ("3 skipped"). */
  skipped: number;
  /** Until when Undo works (ISO), or null. */
  undoUntil: string | null;
}

/** POST /api/templates/buttons/runs/:runId/undo */
export interface UndoResponse {
  /** Changes left because someone changed them since. */
  kept: number;
  messagesSent: number;
}
