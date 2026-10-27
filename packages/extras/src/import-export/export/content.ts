// Page content as the editor saves it (ProseMirror JSON, from `getPageContent`). The exporters and
// the Print view read it without trusting its shape: a node they don't know shows its content.

export interface ContentMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface ContentNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ContentNode[];
  text?: string;
  marks?: ContentMark[];
}

/** The colours of the design kit's palette (text and block colours). */
export const EXPORT_COLORS = [
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
export type ExportColor = (typeof EXPORT_COLORS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNode(value: unknown, depth: number): ContentNode | null {
  if (!isRecord(value) || typeof value.type !== 'string' || depth > 64) return null;
  const node: ContentNode = { type: value.type };
  if (isRecord(value.attrs)) node.attrs = value.attrs;
  if (typeof value.text === 'string') node.text = value.text;
  if (Array.isArray(value.marks)) {
    node.marks = value.marks.flatMap((mark: unknown) =>
      isRecord(mark) && typeof mark.type === 'string'
        ? [{ type: mark.type, ...(isRecord(mark.attrs) ? { attrs: mark.attrs } : {}) }]
        : [],
    );
  }
  if (Array.isArray(value.content)) node.content = toNodes(value.content, depth + 1);
  return node;
}

function toNodes(values: unknown[], depth: number): ContentNode[] {
  return values.flatMap((value) => toNode(value, depth) ?? []);
}

/** A page's blocks from a stored doc (`{ type: 'doc', content }`) or a list of blocks. */
export function blocksOf(doc: unknown): ContentNode[] {
  if (Array.isArray(doc)) return toNodes(doc, 0);
  if (isRecord(doc) && Array.isArray(doc.content)) return toNodes(doc.content, 0);
  return [];
}

/** The first of `names` that is a non-empty string in the node's attrs. */
export function attrText(node: ContentNode | ContentMark, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = node.attrs?.[name];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

export function attrNumber(node: ContentNode, name: string): number | undefined {
  const value = node.attrs?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export interface ColorStyle {
  text?: ExportColor;
  bg?: ExportColor;
}

/** A block's or mark's palette colours (`red`, `red_background`, `bg-red`); others are dropped. */
export function colorsOf(node: ContentNode | ContentMark): ColorStyle {
  const style: ColorStyle = {};
  const read = (value: string | undefined, as: keyof ColorStyle) => {
    if (!value) return;
    const lower = value.toLowerCase();
    const name = lower.replace(/^bg-|^text-|[-_]?background$/g, '');
    const color = EXPORT_COLORS.find((known) => known === name);
    if (color) style[as === 'bg' || name !== lower.replace(/^text-/, '') ? 'bg' : 'text'] = color;
  };
  read(attrText(node, 'color', 'textColor'), node.type === 'highlight' ? 'bg' : 'text');
  read(attrText(node, 'backgroundColor', 'background'), 'bg');
  return style;
}

// What each node is, for the exporters and Print. Lanes' block names map onto these roles; a
// name that isn't listed is a container, which shows its content.
const ROLE_NAMES = {
  paragraph: ['paragraph'],
  heading: ['heading'],
  bulletList: ['bulletList'],
  orderedList: ['orderedList'],
  taskList: ['taskList'],
  listItem: ['listItem', 'taskItem'],
  quote: ['blockquote'],
  code: ['codeBlock'],
  rule: ['horizontalRule'],
  break: ['hardBreak'],
  text: ['text'],
  toggle: ['toggle', 'toggleBlock', 'toggleList', 'details'],
  summary: ['toggleSummary', 'detailsSummary', 'summary'],
  callout: ['callout'],
  columns: ['columns', 'columnList'],
  column: ['column'],
  table: ['table'],
  row: ['tableRow'],
  cell: ['tableCell', 'tableHeader'],
  math: ['mathBlock', 'blockMath', 'equation'],
  mathInline: ['inlineMath', 'mathInline', 'inlineEquation'],
  image: ['image', 'picture'],
  file: ['file', 'attachment', 'pdf', 'video', 'audio'],
  embed: ['embed', 'bookmark'],
  database: ['database', 'inlineDatabase', 'linkedDatabase'],
  page: ['subPage', 'childPage', 'pageBlock', 'pageLink', 'linkToPage'],
  mention: ['mention', 'pageMention', 'userMention', 'personMention', 'dateMention'],
  tab: ['tab'],
  skip: ['tableOfContents', 'toc', 'button', 'breadcrumb'],
  container: [],
} satisfies Record<string, readonly string[]>;

export type NodeRole = keyof typeof ROLE_NAMES;

const ROLES = new Map<string, NodeRole>(
  Object.entries(ROLE_NAMES).flatMap(([role, names]) =>
    names.map((name): [string, NodeRole] => [name, role as NodeRole]),
  ),
);

export function roleOf(node: ContentNode): NodeRole {
  return ROLES.get(node.type) ?? 'container';
}

const INLINE_ROLES = new Set<NodeRole>(['text', 'break', 'mention', 'mathInline']);

/** Whether a node sits inside a line of text (text, mentions, inline equations). */
export function isInline(node: ContentNode): boolean {
  return INLINE_ROLES.has(roleOf(node));
}

/** The page a node points at: a sub-page block, a page mention, a database block. */
export function pageIdOf(node: ContentNode): string | undefined {
  if (['userMention', 'personMention', 'dateMention'].includes(node.type)) return undefined;
  if (node.type === 'mention') {
    const kind = attrText(node, 'kind', 'mentionType');
    return attrText(node, 'pageId') ?? (kind === 'page' ? attrText(node, 'id') : undefined);
  }
  return attrText(node, 'pageId', 'databaseId', 'id');
}

const FILE_PATH = /^\/api\/files\/([0-9a-f-]{36})(?:[?#].*)?$/i;

/** The Care Hub file a picture or file block shows (`fileId`, or a `/api/files/<id>` source). */
export function fileIdOf(node: ContentNode): string | undefined {
  const id = attrText(node, 'fileId');
  if (id) return id;
  const src = attrText(node, 'src', 'url', 'href');
  return src ? FILE_PATH.exec(src)?.[1] : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether an ID from the content can be looked up (page and file IDs are UUIDs). */
export function isContentId(id: string | undefined): id is string {
  return id !== undefined && UUID.test(id);
}

/** Every page and file the blocks point at (by UUID), for looking them up before writing. */
export function referencesIn(blocks: readonly ContentNode[]): {
  pageIds: Set<string>;
  fileIds: Set<string>;
} {
  const pageIds = new Set<string>();
  const fileIds = new Set<string>();
  const visit = (node: ContentNode) => {
    const role = roleOf(node);
    if (role === 'page' || role === 'mention' || role === 'database') {
      const id = pageIdOf(node);
      if (isContentId(id)) pageIds.add(id);
    }
    if (role === 'image' || role === 'file') {
      const id = fileIdOf(node);
      if (isContentId(id)) fileIds.add(id);
    }
    for (const mark of node.marks ?? []) {
      const page = mark.type === 'link' ? pagePathId(attrText(mark, 'href')) : undefined;
      if (isContentId(page)) pageIds.add(page);
    }
    node.content?.forEach(visit);
  };
  blocks.forEach(visit);
  return { pageIds, fileIds };
}

const PAGE_PATH = /^\/p\/([0-9a-f-]{36})(?:[/?#].*)?$/i;

/** The page a Care Hub link (`/p/<id>`) opens. */
export function pagePathId(href: string | undefined): string | undefined {
  return href ? PAGE_PATH.exec(href)?.[1] : undefined;
}

/** All the text in a node, for alt text and table cells. */
export function plainText(node: ContentNode): string {
  if (node.text !== undefined) return node.text;
  if (roleOf(node) === 'break') return ' ';
  return (node.content ?? []).map(plainText).join('');
}
