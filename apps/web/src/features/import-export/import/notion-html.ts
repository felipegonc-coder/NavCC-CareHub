import type { PlanColumnType } from '@carehub/extras/import-export/import/index';

// One page of Notion's HTML export (Import and export spec 3.2; IE-04), for ./notion-importer:
// its title (h1.page-title), a row's properties (table.properties), its databases' tables
// (table.collection-content, each row's title linking to the row's page) and its content
// (.page-body) as HTML that htmlToContent reads as Notion meant it. Property types come from the
// class names Notion gives them ("typesSelect" on a column's icon, "property-row-select" on a
// property); without those, they're guessed as in CSV import.

/** A property's type for the plan; formulas and rollups come in as text and are listed. */
export type NotionType = PlanColumnType | 'title' | 'formula' | 'rollup';

const TYPES = new Map<string, NotionType>([
  ['title', 'title'],
  ['text', 'text'],
  ['number', 'number'],
  ['select', 'select'],
  ['multiselect', 'multi_select'],
  ['multipleselect', 'multi_select'],
  ['status', 'status'],
  ['date', 'date'],
  ['person', 'person'],
  ['createdby', 'person'],
  ['lasteditedby', 'person'],
  ['checkbox', 'checkbox'],
  ['url', 'url'],
  ['email', 'email'],
  ['phonenumber', 'phone'],
  ['formula', 'formula'],
  ['rollup', 'rollup'],
  // Links to rows and files come in as their names.
  ['relation', 'text'],
  ['file', 'text'],
  ['files', 'text'],
]);

/** A column of a database's table, or a property of a row's page. */
export interface NotionProperty {
  name: string;
  type: NotionType | null;
}

export interface NotionRow {
  cells: string[];
  /** Where the row's title links: the row's page. */
  href: string | null;
}

/** A database's table: its columns, the title first, and its rows. */
export interface NotionTable {
  /** An inline database's own title, over its table. */
  title: string | null;
  columns: NotionProperty[];
  rows: NotionRow[];
}

export interface NotionPage {
  title: string | null;
  /** A row's page: its properties, with their values as text. */
  properties: (NotionProperty & { value: string })[];
  tables: NotionTable[];
  /** Whether the page is a database: all it has is its table. */
  isDatabase: boolean;
  /** Its content's HTML. Each table is a link to `#notion-table-<n>` (see tableOf). */
  content: string;
  /** Equations, kept as their TeX: pages can't show them yet. */
  equations: number;
}

const TABLE = 'table.collection-content';
const TEXT = 3;
const ELEMENT = 1;

const typeOf = (name: string | undefined) =>
  name === undefined ? null : (TYPES.get(name.replace(/[-_]/g, '').toLowerCase()) ?? null);

/** The rest of the element's class name that starts with `start`: "Select" of "typesSelect". */
const classAfter = (element: Element | null | undefined, start: string) =>
  Array.from(element?.classList ?? [])
    .find((name) => name.length > start.length && name.startsWith(start))
    ?.slice(start.length);

/** What an element shows, without its icons: a cell, a property's name, a title. */
function textOf(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  for (const icon of Array.from(copy.querySelectorAll('.icon, svg, style, script'))) icon.remove();
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** What a cell can be made of, and whether Notion puts "@" before each ("@Sam Ortiz"). */
const PARTS: [selector: string, at: boolean][] = [
  ['.selected-value, .status-value', false],
  ['.user', true],
  ['time', true],
  ['a', false],
];

/**
 * A cell or property as text, as Notion's CSV export has it: options, people, dates and links
 * with ", " between them, and checkboxes as Yes or No.
 */
export function cellValue(cell: Element): string {
  const text = textOf(cell);
  const box = cell.querySelector('.checkbox');
  if (box && text === '') return box.classList.contains('checkbox-on') ? 'Yes' : 'No';
  const bare = (value: string) => value.replace(/[\s,]+/g, '');
  for (const [selector, at] of PARTS) {
    const parts = Array.from(cell.querySelectorAll(selector), textOf).filter(Boolean);
    // Only when they're all the cell has: a date in a sentence stays in the sentence.
    if (parts.length === 0 || bare(parts.join('')) !== bare(text)) continue;
    return parts.map((part) => (at ? part.replace(/^@/, '') : part)).join(', ');
  }
  return text;
}

/** The list with the item at `at` first. */
const titleFirst = <T>(list: readonly T[], at: number): T[] => [
  ...list.slice(at, at + 1),
  ...list.slice(0, at),
  ...list.slice(at + 1),
];

function readTable(table: HTMLTableElement): Omit<NotionTable, 'title'> {
  const head = Array.from(table.tHead?.rows[0]?.cells ?? []);
  const rows = Array.from(table.tBodies).flatMap((body) => Array.from(body.rows));
  const columns = head.map((cell) => ({
    name: textOf(cell),
    type: typeOf(classAfter(cell.querySelector('svg'), 'types')),
  }));
  const marked = Array.from(rows[0]?.cells ?? []).findIndex((cell) =>
    cell.classList.contains('cell-title'),
  );
  const typed = columns.findIndex(({ type }) => type === 'title');
  const at = Math.max(0, marked >= 0 ? marked : typed);
  return {
    columns: titleFirst(columns, at),
    rows: rows.map((row) => {
      const cells = Array.from(row.cells);
      return {
        cells: titleFirst(cells, at).map(cellValue),
        href: cells[at]?.querySelector('a[href]')?.getAttribute('href') ?? null,
      };
    }),
  };
}

/** What a database's table stands in: the table, or the block with its title over it. */
function blockOf(table: Element): Element {
  const parent = table.parentElement;
  const titled = parent?.localName === 'div' && parent.classList.contains('collection-content');
  return parent && titled ? parent : table;
}

/** The same kind of list right after `list`, with nothing between them. */
function nextList(list: Element): Element | null {
  let node = list.nextSibling;
  while (node?.nodeType === TEXT && !node.textContent?.trim()) node = node.nextSibling;
  const next = node?.nodeType === ELEMENT ? (node as Element) : null;
  return next?.localName === list.localName && next.className === list.className ? next : null;
}

/**
 * Notion's blocks as htmlToContent reads them: list items one after another as one list, to-dos
 * with their checks, a callout's icon, bookmarks as links, no icons on links or people, and
 * equations as their TeX. Gives the number of equations.
 */
function asHtml(content: Element): number {
  const page = content.ownerDocument;
  for (const kind of ['bulleted-list', 'numbered-list', 'to-do-list']) {
    for (const list of Array.from(content.getElementsByClassName(kind))) {
      if (!list.isConnected) continue;
      for (let next = nextList(list); next; next = nextList(list)) {
        list.append(...Array.from(next.childNodes));
        next.remove();
      }
    }
  }
  for (const list of Array.from(content.querySelectorAll('ul.to-do-list'))) {
    list.setAttribute('data-type', 'taskList');
    for (const item of Array.from(list.children)) {
      const box = Array.from(item.children).find((child) => child.classList.contains('checkbox'));
      item.setAttribute('data-checked', String(box?.classList.contains('checkbox-on') ?? false));
      box?.remove();
    }
  }
  for (const callout of Array.from(content.getElementsByClassName('callout'))) {
    const icon = callout.firstElementChild;
    if (icon?.querySelector('.icon')) icon.classList.add('callout-icon');
  }
  for (const icon of Array.from(content.querySelectorAll('img.icon, a .icon, .user .icon'))) {
    icon.remove();
  }
  for (const bookmark of Array.from(content.querySelectorAll('a.bookmark'))) {
    const link = page.createElement('a');
    const href = bookmark.getAttribute('href') ?? '';
    const title = bookmark.querySelector('.bookmark-title');
    link.setAttribute('href', href);
    link.textContent = (title && textOf(title)) || href;
    bookmark.replaceWith(link);
  }
  for (const span of Array.from(content.querySelectorAll('span[style*="border-bottom"]'))) {
    if (!/border-bottom:\s*0\.05em solid/i.test(span.getAttribute('style') ?? '')) continue;
    const underline = page.createElement('u');
    underline.append(...Array.from(span.childNodes));
    span.replaceWith(underline);
  }
  let equations = 0;
  for (const math of Array.from(content.getElementsByClassName('katex'))) {
    if (!math.isConnected) continue;
    const code = page.createElement('code');
    code.textContent = math.querySelector('annotation')?.textContent?.trim() || textOf(math);
    const block = math.closest('figure.equation');
    if (block) {
      const pre = page.createElement('pre');
      pre.append(code);
      block.replaceWith(pre);
    } else {
      math.replaceWith(code);
    }
    equations += 1;
  }
  return equations;
}

/** A page of the export: what ./notion-importer needs from it (see NotionPage). */
export function readNotionPage(html: string): NotionPage {
  const page = new DOMParser().parseFromString(html, 'text/html');
  const heading = page.querySelector('h1.page-title');
  const title = (heading ? textOf(heading) : page.title.replace(/\s+/g, ' ').trim()) || null;
  const properties = Array.from(page.querySelectorAll('table.properties tr')).flatMap((row) => {
    const name = row.querySelector('th');
    const value = row.querySelector('td');
    if (!name || !value) return [];
    const type =
      typeOf(classAfter(row, 'property-row-')) ??
      typeOf(classAfter(name.querySelector('svg'), 'types'));
    return [{ name: textOf(name), type, value: cellValue(value) }];
  });
  page.querySelector('article > header')?.remove();
  const content = page.querySelector('.page-body') ?? page.body;
  const found = Array.from(content.querySelectorAll<HTMLTableElement>(TABLE));
  const parts = Array.from(content.children).filter((child) => child.textContent?.trim());
  const only = found.length === 1 ? found[0] : undefined;
  const isDatabase = only !== undefined && parts.length === 1 && parts[0] === blockOf(only);
  const tables = found.map((table, index) => {
    const block = blockOf(table);
    const named = block === table ? null : block.querySelector('.collection-title');
    const own = { ...readTable(table), title: (named && textOf(named)) || null };
    const link = page.createElement('a');
    link.setAttribute('href', `#notion-table-${index}`);
    link.textContent = own.title ?? title ?? 'Untitled';
    const line = page.createElement('p');
    line.append(link);
    block.replaceWith(line);
    return own;
  });
  const equations = asHtml(content);
  return { title, properties, tables, isDatabase, content: content.outerHTML, equations };
}

/** The table a link of NotionPage.content stands for, or null for other links. */
export function tableOf(href: string): number | null {
  const match = /^#notion-table-(\d{1,5})$/.exec(href);
  return match ? Number(match[1]) : null;
}
