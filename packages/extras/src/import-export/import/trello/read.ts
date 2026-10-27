// Reading a Trello board's JSON export (Import and export spec, section 3.2; IE-07): its lists,
// labels, members and cards, each card with its checklists, attachments and comments, so the
// board can become a database with a Board view grouped by list. Fields it doesn't use are
// ignored and a value of the wrong type reads as missing, so older and newer exports still read.
import { z } from 'zod';

/** Databases' option colours, which labels keep as the colour of their option. */
export type OptionColor =
  'default' | 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red';

const COLORS: Partial<Record<string, OptionColor>> = {
  green: 'green',
  yellow: 'yellow',
  orange: 'orange',
  red: 'red',
  purple: 'purple',
  blue: 'blue',
  sky: 'blue',
  lime: 'green',
  pink: 'pink',
  black: 'gray',
};

/** A Trello colour ("sky", "green_dark") as the nearest option colour, else "default". */
export function trelloColor(color: unknown): OptionColor {
  if (typeof color !== 'string') return 'default';
  return COLORS[color.replace(/_(?:dark|light)$/, '')] ?? 'default';
}

export interface TrelloList {
  id: string;
  name: string;
  archived: boolean;
}

export interface TrelloLabel {
  id: string;
  /** Trello allows labels with a colour only; those are named after it ("Green"). */
  name: string;
  color: OptionColor;
}

export interface TrelloMember {
  id: string;
  name: string;
  username: string | null;
}

export interface TrelloChecklist {
  name: string;
  items: { name: string; done: boolean }[];
}

export interface TrelloComment {
  author: string;
  /** ISO 8601, as Trello wrote it. */
  date: string;
  /** Markdown, as typed in Trello. */
  text: string;
}

export interface TrelloCard {
  id: string;
  name: string;
  /** Markdown, as typed in Trello. */
  description: string;
  /** The card's list; it may be one the export doesn't have. */
  listId: string;
  archived: boolean;
  labelIds: string[];
  memberIds: string[];
  /** ISO 8601 date and time, or null. */
  start: string | null;
  due: string | null;
  dueComplete: boolean;
  checklists: TrelloChecklist[];
  /** Web addresses only: uploads stay on Trello, behind its sign-in. */
  attachments: { name: string; url: string }[];
  /** Oldest first. */
  comments: TrelloComment[];
}

export interface TrelloBoard {
  name: string;
  /** In the board's order. */
  lists: TrelloList[];
  labels: TrelloLabel[];
  members: TrelloMember[];
  /** By list, in the board's order, then in each list's order. */
  cards: TrelloCard[];
}

const text = z.string().catch('');
const flag = z.boolean().catch(false);
const position = z.number().catch(0);
const strings = z.array(z.string()).catch([]);
const when = z.string().nullable().catch(null);

const listSchema = z.object({ id: z.string(), name: text, closed: flag, pos: position });
const labelSchema = z.object({ id: z.string(), name: text, color: z.unknown().optional() });
const memberSchema = z.object({ id: z.string(), fullName: text, username: text });
const attachmentSchema = z.object({ name: text, url: z.string() });
const cardSchema = z.object({
  id: z.string(),
  name: text,
  desc: text,
  closed: flag,
  idList: text,
  pos: position,
  idLabels: strings,
  idMembers: strings,
  start: when.optional(),
  due: when.optional(),
  dueComplete: flag,
  attachments: z.unknown().optional(),
});
const checklistSchema = z.object({
  idCard: z.string(),
  name: text,
  pos: position,
  checkItems: z.unknown().optional(),
});
const checkItemSchema = z.object({ name: text, state: text, pos: position });
const actionSchema = z.object({
  type: z.literal('commentCard'),
  date: text,
  idMemberCreator: text,
  memberCreator: z.object({ fullName: text }).optional().catch(undefined),
  data: z.object({ text: z.string(), card: z.object({ id: z.string() }) }),
});

/** The items of `value` that `schema` reads; the rest are left out. */
function each<T>(schema: z.ZodType<T>, value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  const items: T[] = [];
  for (const item of value) {
    const read = schema.safeParse(item);
    if (read.success) items.push(read.data);
  }
  return items;
}

const byPosition = (a: { pos: number }, b: { pos: number }) => a.pos - b.pos;
const WEB_ADDRESS = /^https?:\/\//i;

/** A label without a name is named after its colour, as Trello shows it. */
function labelName(name: string, color: unknown): string {
  if (name.trim()) return name.trim();
  if (typeof color !== 'string' || !color) return 'Label';
  const plain = color.replace(/_/g, ' ');
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

/**
 * The board in a Trello JSON export (board menu → Print, export and share → Export as JSON), or
 * null when `json` isn't one.
 */
export function readTrelloBoard(json: unknown): TrelloBoard | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const board = json as Record<string, unknown>;
  if (
    typeof board.name !== 'string' ||
    !Array.isArray(board.lists) ||
    !Array.isArray(board.cards)
  ) {
    return null;
  }
  const lists = each(listSchema, board.lists).sort(byPosition);
  const listOrder = new Map(lists.map((list, index) => [list.id, index]));
  const members = each(memberSchema, board.members).map((member) => ({
    id: member.id,
    name: member.fullName.trim() || member.username.trim() || 'Trello member',
    username: member.username.trim() || null,
  }));
  const memberNames = new Map(members.map((member) => [member.id, member.name]));

  const checklists = new Map<string, TrelloChecklist[]>();
  for (const checklist of each(checklistSchema, board.checklists).sort(byPosition)) {
    const items = each(checkItemSchema, checklist.checkItems)
      .sort(byPosition)
      .map((item) => ({ name: item.name, done: item.state === 'complete' }));
    const list = checklists.get(checklist.idCard) ?? [];
    list.push({ name: checklist.name.trim() || 'Checklist', items });
    checklists.set(checklist.idCard, list);
  }

  const comments = new Map<string, TrelloComment[]>();
  for (const action of each(actionSchema, board.actions)) {
    const list = comments.get(action.data.card.id) ?? [];
    list.push({
      author:
        action.memberCreator?.fullName.trim() ||
        memberNames.get(action.idMemberCreator) ||
        'Trello member',
      date: action.date,
      text: action.data.text,
    });
    comments.set(action.data.card.id, list);
  }

  const cards = each(cardSchema, board.cards)
    .map((card, index) => ({ card, index }))
    .sort(
      (a, b) =>
        (listOrder.get(a.card.idList) ?? lists.length) -
          (listOrder.get(b.card.idList) ?? lists.length) ||
        a.card.pos - b.card.pos ||
        a.index - b.index,
    )
    .map(({ card }) => ({
      id: card.id,
      name: card.name.trim() || 'Untitled',
      description: card.desc,
      listId: card.idList,
      archived: card.closed,
      labelIds: card.idLabels,
      memberIds: card.idMembers,
      start: card.start || null,
      due: card.due || null,
      dueComplete: card.dueComplete,
      checklists: checklists.get(card.id) ?? [],
      attachments: each(attachmentSchema, card.attachments)
        .filter(({ url }) => WEB_ADDRESS.test(url.trim()))
        .map(({ name, url }) => ({ name: name.trim() || url.trim(), url: url.trim() })),
      // Trello lists actions newest first.
      comments: (comments.get(card.id) ?? []).sort((a, b) => a.date.localeCompare(b.date)),
    }));

  return {
    name: board.name.trim() || 'Trello board',
    lists: lists.map(({ id, name, closed }) => ({
      id,
      name: name.trim() || 'Untitled list',
      archived: closed,
    })),
    labels: each(labelSchema, board.labels).map(({ id, name, color }) => ({
      id,
      name: labelName(name, color),
      color: trelloColor(color),
    })),
    members,
    cards,
  };
}
