// The Trello importer (Import and export spec, section 3.2; IE-07): a board's JSON export becomes
// one database, a row per card. Its list is the card's Status (options in the board's order), its
// labels a multi-select, then its members, start and due dates, and the card's description,
// checklists and attachment links as the row's page.
import {
  IMPORT_LIMITS,
  ImportFileError,
  type ImportPlan,
  type Importer,
  type PlanColumn,
  type PlanRow,
} from '../plan';
import { escapeMarkdown, markdownLink, oneLine } from '../writer/markdown';
import { PlanWriter, shortName } from '../writer/plan-writer';
import { readTrelloBoard, type TrelloBoard, type TrelloCard } from './read';

const NOT_TRELLO = "the file isn't a Trello board's JSON export";
const TOO_MANY_CARDS = 'databases can have up to 20,000 rows';
/** Databases' longest option name. */
const OPTION_CHARS = 100;

export interface TrelloOptions {
  /** Spec 3.2: archived cards come in only with "Include archived". */
  includeArchived?: boolean;
}

/** A card's page: its description, then each checklist as to-dos, then its attachment links. */
function cardMarkdown(card: TrelloCard): string {
  const parts: string[] = [];
  if (card.description.trim()) parts.push(card.description.trim());
  for (const checklist of card.checklists) {
    parts.push(`## ${escapeMarkdown(oneLine(checklist.name))}`);
    if (checklist.items.length > 0) {
      parts.push(
        checklist.items
          .map((item) => `- [${item.done ? 'x' : ' '}] ${escapeMarkdown(oneLine(item.name))}`)
          .join('\n'),
      );
    }
  }
  if (card.attachments.length > 0) {
    parts.push('## Attachments');
    parts.push(card.attachments.map((file) => `- ${markdownLink(file.name, file.url)}`).join('\n'));
  }
  return parts.join('\n\n');
}

/** The plan for a board that `readTrelloBoard` read from the file `fileName`. */
export function trelloPlan(
  board: TrelloBoard,
  fileName: string,
  options: TrelloOptions = {},
): ImportPlan {
  const out = new PlanWriter(fileName);
  const archivedLists = new Set(board.lists.filter((list) => list.archived).map((list) => list.id));
  const isArchived = (card: TrelloCard) => card.archived || archivedLists.has(card.listId);
  const cards = options.includeArchived ? board.cards : board.cards.filter((c) => !isArchived(c));
  if (cards.length > IMPORT_LIMITS.rows) throw new ImportFileError(TOO_MANY_CARDS);
  const leftOut = board.cards.length - cards.length;
  if (leftOut > 0) {
    const count = leftOut.toLocaleString('en-US');
    out.problem(null, 'Left out', `${count} ${leftOut === 1 ? 'card is' : 'cards are'} archived.`);
  }

  const option = (name: string, what: string) => out.cut(name, OPTION_CHARS, what);
  const listNames = new Map(
    board.lists.map((list) => [list.id, option(list.name, `List "${shortName(list.name)}"`)]),
  );
  const labelNames = new Map(
    board.labels.map((label) => {
      // A multi-select cell lists its options with commas between them.
      const name = label.name.replace(/\s*,\s*/g, ' ').trim() || 'Label';
      if (name !== label.name) {
        const why = `Options can't have commas, so it's "${name}".`;
        out.problem(`Label "${shortName(label.name)}"`, 'Renamed', why);
      }
      return [label.id, option(name, `Label "${shortName(name)}"`)];
    }),
  );
  const memberNames = new Map(board.members.map((member) => [member.id, member.name]));
  const names = (ids: readonly string[], from: ReadonlyMap<string, string>) =>
    ids.flatMap((id) => from.get(id) ?? []).join(', ');

  const columns: { column: PlanColumn; cell: (card: TrelloCard) => string }[] = [
    { column: { name: 'Name', type: 'text' }, cell: (card) => card.name },
    {
      column: { name: 'Status', type: 'status' },
      cell: (card) => listNames.get(card.listId) ?? '',
    },
    {
      column: { name: 'Labels', type: 'multi_select' },
      cell: (card) => names(card.labelIds, labelNames),
    },
    {
      column: { name: 'Members', type: 'text' },
      cell: (card) => names(card.memberIds, memberNames),
    },
    { column: { name: 'Start', type: 'date' }, cell: (card) => card.start ?? '' },
    { column: { name: 'Due', type: 'date' }, cell: (card) => card.due ?? '' },
    {
      column: { name: 'Due complete', type: 'checkbox' },
      cell: (card) => (card.due ? String(card.dueComplete) : ''),
    },
  ];
  if (options.includeArchived) {
    columns.push({
      column: { name: 'Archived', type: 'checkbox' },
      cell: (card) => String(isArchived(card)),
    });
  }
  // Name and Status always; the others when a card has a value for them.
  const used = columns.filter((col, i) => i < 2 || cards.some((card) => col.cell(card) !== ''));

  const rows = cards.map((card): PlanRow => {
    const what = `Card "${shortName(card.name)}"`;
    const cells = used.map(({ column, cell }, i) =>
      i === 0
        ? out.text(cell(card), IMPORT_LIMITS.titleChars, what)
        : out.text(cell(card), IMPORT_LIMITS.cellChars, `${what}, ${column.name}`),
    );
    const markdown = cardMarkdown(card);
    const row: PlanRow = { key: out.key('card'), cells };
    if (markdown) row.content = { markdown: out.text(markdown, IMPORT_LIMITS.pageChars, what) };
    return row;
  });

  for (const { column } of used) out.spend(column.name.length);
  out.plan.databases.push({
    key: out.key('board'),
    parent: null,
    title: out.text(board.name, IMPORT_LIMITS.titleChars, `Board "${shortName(board.name)}"`),
    columns: used.map(({ column }) => column),
    rows,
    source: fileName,
  });
  return out.done();
}

export const trelloImporter: Importer = {
  source: 'trello',
  async plan(input) {
    let json: unknown;
    try {
      json = JSON.parse(await input.text());
    } catch {
      throw new ImportFileError(NOT_TRELLO);
    }
    const board = readTrelloBoard(json);
    if (!board) throw new ImportFileError(NOT_TRELLO);
    return trelloPlan(board, input.fileName);
  },
};
