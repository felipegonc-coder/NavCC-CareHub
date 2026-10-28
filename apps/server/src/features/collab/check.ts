import { LINK_OPTIONS, PAGE_FIELD, createPageSchema } from '@carehub/editor/schema';
import * as Y from 'yjs';
import { MAX_DEPTH, countBlocks, isRecord, markName } from './ydoc';

/** Pages longer than this are refused (Pages and blocks, limits). */
export const MAX_BLOCKS = 20_000;
/** The most a page's Yjs state may take: what's stored plus the changes accepted since. */
export const MAX_PAGE_BYTES = 16 * 1024 * 1024;
/** The most text one update may add, and the most it may set in attributes and marks. */
export const MAX_TEXT_CHARS = 1_000_000;
export const MAX_ATTRIBUTE_CHARS = 1_000_000;
/** The longest string an attribute or mark may hold, addresses included. */
export const MAX_VALUE_CHARS = 8_192;
/** How often, at most, a page near a limit is measured again: measuring copies it. */
export const MEASURE_EVERY_MS = 5_000;
/**
 * Added to the estimate for each struct and each deleted range in an update, on top of its
 * length: about two item headers, for the items Yjs splits to fit it in.
 */
const CHANGE_BYTES = 40;

/** What the page schema allows, read once from `createPageSchema()` (every lane's blocks). */
export interface SchemaInfo {
  nodes: ReadonlySet<string>;
  marks: ReadonlySet<string>;
  inline: ReadonlySet<string>;
  /** The attributes each node and mark type defines. No others are accepted. */
  nodeAttrs: ReadonlyMap<string, ReadonlySet<string>>;
  markAttrs: ReadonlyMap<string, ReadonlySet<string>>;
  isSafeUrl: (url: string) => boolean;
}

let cached: SchemaInfo | undefined;

export function pageSchemaInfo(): SchemaInfo {
  if (cached) return cached;
  const schema = createPageSchema();
  const nodes = Object.values(schema.nodes);
  const marks = Object.values(schema.marks);
  const attrs = (type: { name: string; spec: { attrs?: object | null } }) =>
    [type.name, new Set(Object.keys(type.spec.attrs ?? {}))] as const;
  cached = {
    nodes: new Set(nodes.map((type) => type.name)),
    inline: new Set(nodes.filter((type) => type.isInline).map((type) => type.name)),
    marks: new Set(marks.map((type) => type.name)),
    nodeAttrs: new Map(nodes.map(attrs)),
    markAttrs: new Map(marks.map(attrs)),
    isSafeUrl: (url) => LINK_OPTIONS.isAllowedUri(url),
  };
  return cached;
}

/** Attribute names whose values a browser may open or load. */
export const URL_KEYS: ReadonlySet<string> = new Set(['href', 'src', 'url']);
/** Attribute names whose values go into CSS: only a colour or a single keyword. */
const STYLE_KEYS = new Set(['color', 'backgroundColor', 'textAlign', 'style']);
const STYLE_VALUE = /^(?:#[0-9a-f]{3,8}|[a-z][a-z0-9-]{0,31})$/i;
/** Node names that can't appear as blocks. */
const NOT_BLOCKS = new Set(['doc', 'text']);

/** A page's size. Callers keep it between updates as an upper bound: deletes aren't subtracted. */
export interface PageSize {
  blocks: number;
  /** The length of the page's encoded Yjs state. */
  bytes: number;
}

export function pageSize(doc: Y.Doc, info: SchemaInfo): PageSize {
  return { blocks: countBlocks(doc, info.inline), bytes: Y.encodeStateAsUpdate(doc).length };
}

export type UpdateCheck =
  { ok: true; size: PageSize } | { ok: false; reason: string; tooLong?: true };

type Where =
  | { kind: 'root'; key: string }
  | { kind: 'element'; nodeName: string }
  | { kind: 'text' }
  | { kind: 'gone' }
  | { kind: 'other' };

interface Position {
  where: Where;
  /** The attribute (map key) the item sets, or null for list content. */
  sub: string | null;
  /** How many elements hold the item: 0 at the top of the page. */
  depth: number;
}

const GONE: Position = { where: { kind: 'gone' }, sub: null, depth: 0 };
const OTHER: Position = { where: { kind: 'other' }, sub: null, depth: 0 };
/** Where a chain of new elements too long to follow ends: anything below it is too deep. */
const TOO_DEEP: Position = {
  where: { kind: 'element', nodeName: '' },
  sub: null,
  depth: MAX_DEPTH,
};

/** When each page was last measured. */
const measuredAt = new WeakMap<Y.Doc, number>();

/**
 * Checks a Yjs update before the server applies or relays it (issue #14): only the page's
 * blocks, only node and mark types the schema knows with the attributes it defines, no embeds
 * or binary content, only safe addresses in links and `href`/`src`/`url` attributes, at most
 * MAX_DEPTH levels of blocks, and limits on the update and the page. `size` is the page's size
 * before the update, if the caller keeps it; the result's size is the new upper bound.
 *
 * Every update counts toward the page's size, deleted content and deletes too. When the estimate
 * passes MAX_BLOCKS or MAX_PAGE_BYTES, the update is applied to a copy of the page and measured.
 * It's refused if it leaves the page past MAX_BLOCKS, or past MAX_PAGE_BYTES without making it
 * smaller (so a page that's too large can still be cut down). A page is measured at most once
 * every MEASURE_EVERY_MS (`now` is the time in milliseconds); in between, updates that may take
 * it past a limit are refused.
 */
export function checkUpdate(
  update: Uint8Array,
  doc: Y.Doc,
  info: SchemaInfo,
  size: PageSize = pageSize(doc, info),
  now = Date.now(),
): UpdateCheck {
  let decoded: ReturnType<typeof Y.decodeUpdate>;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    return { ok: false, reason: 'unreadable update' };
  }
  const { structs, ds } = decoded;
  const incoming = new Map<number, Y.Item[]>();
  for (const struct of structs) {
    if (!(struct instanceof Y.Item)) continue;
    const list = incoming.get(struct.id.client);
    if (list) list.push(struct);
    else incoming.set(struct.id.client, [struct]);
  }
  const locate = locator(doc, incoming);
  let added = 0;
  let textChars = 0;
  let attributeChars = 0;
  for (const struct of structs) {
    // GC and Skip structs hold nothing. Editors send them, and deleted content, when they sync.
    if (!(struct instanceof Y.Item)) continue;
    const { content } = struct;
    if (content instanceof Y.ContentDeleted) {
      // Deleted content shows nothing, but the page keeps it, so it may go only into the page.
      const position = locate(struct);
      if (!position) return { ok: false, reason: 'unknown position' };
      const { where } = position;
      if (where.kind === 'root' && where.key !== PAGE_FIELD) {
        return { ok: false, reason: 'unknown field' };
      }
      continue;
    }
    if (content instanceof Y.ContentString) textChars += content.str.length;
    else if (content instanceof Y.ContentAny) attributeChars += jsonLength(content.arr);
    else if (content instanceof Y.ContentFormat) attributeChars += jsonLength(content.value);
    if (textChars > MAX_TEXT_CHARS) return { ok: false, reason: 'too much text', tooLong: true };
    if (attributeChars > MAX_ATTRIBUTE_CHARS) {
      return { ok: false, reason: 'attributes too long', tooLong: true };
    }
    const position = locate(struct);
    if (!position) return { ok: false, reason: 'unknown position' };
    const problem = contentProblem(struct.content, position, info);
    if (problem) return { ok: false, reason: problem };
    const type = struct.content instanceof Y.ContentType ? struct.content.type : null;
    if (!(type instanceof Y.XmlElement) || position.where.kind === 'gone') continue;
    if (position.depth >= MAX_DEPTH) return { ok: false, reason: 'nested too deeply' };
    if (!info.inline.has(type.nodeName)) added += 1;
  }
  // An update adds its own length to the page, and Yjs may split an item for each struct and
  // deleted range in it. Deletes aren't subtracted, so the estimate stays an upper bound.
  let ranges = 0;
  for (const list of ds.clients.values()) ranges += list.length;
  const estimate: PageSize = {
    blocks: size.blocks + added,
    bytes: size.bytes + update.length + CHANGE_BYTES * (structs.length + ranges),
  };
  const tooManyBlocks = added > 0 && estimate.blocks > MAX_BLOCKS;
  const tooLarge = estimate.bytes > MAX_PAGE_BYTES;
  if (!tooManyBlocks && !tooLarge) return { ok: true, size: estimate };
  const last = measuredAt.get(doc);
  if (last !== undefined && now >= last && now < last + MEASURE_EVERY_MS) {
    return { ok: false, reason: tooManyBlocks ? 'too many blocks' : 'too large', tooLong: true };
  }
  measuredAt.set(doc, now);
  const after = measureAfter(update, doc, info);
  if (tooManyBlocks && after.blocks > MAX_BLOCKS) {
    return { ok: false, reason: 'too many blocks', tooLong: true };
  }
  if (after.bytes > MAX_PAGE_BYTES && after.bytes >= after.before) {
    return { ok: false, reason: 'too large', tooLong: true };
  }
  return { ok: true, size: { blocks: after.blocks, bytes: after.bytes } };
}

function jsonLength(value: unknown): number {
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return 0; // a value JSON can't hold (a BigInt) is refused as unsafe
  }
}

/** The page's size once `update` is applied, and its length in bytes before, measured on a copy. */
function measureAfter(
  update: Uint8Array,
  doc: Y.Doc,
  info: SchemaInfo,
): PageSize & { before: number } {
  const copy = new Y.Doc();
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const before = Y.encodeStateAsUpdate(copy).length;
    Y.applyUpdate(copy, update);
    const bytes = Y.encodeStateAsUpdate(copy).length;
    return { before, blocks: countBlocks(copy, info.inline), bytes };
  } finally {
    copy.destroy();
  }
}

function contentProblem(content: Y.Item['content'], at: Position, info: SchemaInfo): string | null {
  const { where, sub } = at;
  if (where.kind === 'gone') return null; // inside content Yjs already dropped
  if (where.kind === 'root' && where.key !== PAGE_FIELD) return 'unknown field';
  if (sub !== null) {
    if (where.kind !== 'element' || !(content instanceof Y.ContentAny))
      return 'unexpected attribute';
    if (!info.nodeAttrs.get(where.nodeName)?.has(sub)) return 'unknown attribute';
    return content.arr.every((value) => isSafeValue(sub, value, info, 0))
      ? null
      : 'unsafe attribute';
  }
  if (where.kind === 'text') {
    if (content instanceof Y.ContentString) return null;
    if (content instanceof Y.ContentFormat) {
      return isSafeMark(content.key, content.value, info) ? null : 'unsafe mark';
    }
    return 'unexpected inline content';
  }
  if (where.kind !== 'root' && where.kind !== 'element') return 'unexpected position';
  if (!(content instanceof Y.ContentType)) return 'unexpected content';
  const type = content.type;
  if (type instanceof Y.XmlText) return where.kind === 'element' ? null : 'unexpected text';
  if (type instanceof Y.XmlElement && info.nodes.has(type.nodeName)) {
    return NOT_BLOCKS.has(type.nodeName) ? 'unknown block' : null;
  }
  return 'unknown block';
}

function isSafeMark(key: string, value: unknown, info: SchemaInfo): boolean {
  const attrs = info.markAttrs.get(markName(key));
  if (!attrs) return false;
  if (value === null) return true;
  return (
    isRecord(value) &&
    Object.entries(value).every(([k, v]) => attrs.has(k) && isSafeValue(k, v, info, 1))
  );
}

/**
 * An attribute value: plain JSON with strings up to MAX_VALUE_CHARS, only safe addresses under
 * URL_KEYS and only a colour or a keyword under STYLE_KEYS.
 */
export function isSafeValue(key: string, value: unknown, info: SchemaInfo, depth: number): boolean {
  if (typeof value === 'string') {
    if (value.length > MAX_VALUE_CHARS) return false;
    if (URL_KEYS.has(key)) return info.isSafeUrl(value);
    return !STYLE_KEYS.has(key) || STYLE_VALUE.test(value);
  }
  if (value === null || value === undefined) return true;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (depth >= 8) return false;
  if (Array.isArray(value)) return value.every((item) => isSafeValue(key, item, info, depth + 1));
  if (isRecord(value)) {
    return Object.entries(value).every(([k, v]) => isSafeValue(k, v, info, depth + 1));
  }
  return false;
}

/**
 * Finds where each incoming item goes. An item with a left or right neighbour doesn't carry its
 * parent; it shares the neighbour's, which may be in the document or earlier in the update.
 */
function locator(doc: Y.Doc, incoming: Map<number, Y.Item[]>): (item: Y.Item) => Position | null {
  const memo = new Map<Y.Item, Position | null>();
  const find = (id: Y.ID) =>
    findStruct(doc.store.clients.get(id.client), id.clock) ??
    findStruct(incoming.get(id.client), id.clock);

  /** Where content goes whose parent is `owner`, the item named by its parent ID. */
  const inside = (
    owner: Y.Item | Y.GC | null,
    sub: string | null,
    level: number,
  ): Position | null => {
    // A deleted block: the server keeps its item as ContentDeleted and its children as GC. What
    // someone added to it at the same time (typing into a paragraph another person deleted) is
    // dropped by Yjs, so it's no reason to refuse the update.
    if (owner instanceof Y.GC || owner?.content instanceof Y.ContentDeleted) return GONE;
    if (!owner) return null;
    if (!(owner.content instanceof Y.ContentType)) return OTHER;
    const type = owner.content.type;
    if (type._item === owner) return { where: describe(type, doc), sub, depth: typeDepth(type) };
    // A type that's new in this update is one level below wherever its own item goes.
    const at = level > MAX_DEPTH ? TOO_DEEP : locate(owner, level + 1);
    if (!at || at.where.kind === 'gone') return at;
    const depth = at.depth + (type instanceof Y.XmlElement ? 1 : 0);
    return { where: describe(type, doc), sub, depth };
  };

  const locate = (item: Y.Item, level: number): Position | null => {
    const chain = new Set<Y.Item>();
    let current = item;
    let result: Position | null = null;
    for (;;) {
      const known = memo.get(current);
      if (known !== undefined) {
        result = known;
        break;
      }
      const parent: unknown = current.parent;
      if (typeof parent === 'string') {
        result = { where: { kind: 'root', key: parent }, sub: current.parentSub, depth: 0 };
        break;
      }
      if (parent instanceof Y.AbstractType) {
        const depth = typeDepth(parent);
        result = { where: describe(parent, doc), sub: current.parentSub, depth };
        break;
      }
      if (parent instanceof Y.ID) {
        result = inside(find(parent), current.parentSub, level);
        break;
      }
      const near = current.origin ?? current.rightOrigin;
      const neighbour = near ? find(near) : null;
      if (neighbour instanceof Y.GC) {
        result = GONE;
        break;
      }
      if (!neighbour || neighbour === current || chain.has(neighbour)) break;
      chain.add(current);
      current = neighbour;
    }
    memo.set(current, result);
    for (const link of chain) memo.set(link, result);
    return result;
  };

  return (item) => locate(item, 0);
}

/** How many elements hold the content of `type`, counting `type` itself if it's one. */
function typeDepth(type: Y.AbstractType<unknown>): number {
  let depth = 0;
  let item = type._item;
  while (item && depth <= MAX_DEPTH) {
    if (item.content instanceof Y.ContentType && item.content.type instanceof Y.XmlElement) {
      depth += 1;
    }
    const parent: unknown = item.parent;
    item = parent instanceof Y.AbstractType ? parent._item : null;
  }
  return depth;
}

function describe(type: unknown, doc: Y.Doc): Where {
  if (type instanceof Y.XmlText) return { kind: 'text' };
  if (type instanceof Y.XmlElement) return { kind: 'element', nodeName: type.nodeName };
  if (type instanceof Y.AbstractType && type._item === null) {
    for (const [key, shared] of doc.share) if (shared === type) return { kind: 'root', key };
  }
  return { kind: 'other' };
}

function findStruct<T extends { id: Y.ID; length: number }>(
  list: readonly T[] | undefined,
  clock: number,
): T | null {
  if (!list) return null;
  let low = 0;
  let high = list.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const struct = list[middle];
    if (!struct) return null;
    if (clock < struct.id.clock) high = middle - 1;
    else if (clock >= struct.id.clock + struct.length) low = middle + 1;
    else return struct;
  }
  return null;
}
