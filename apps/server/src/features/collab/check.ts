import { LINK_OPTIONS, PAGE_FIELD, createPageSchema } from '@carehub/editor/schema';
import * as Y from 'yjs';
import { isRecord, markName } from './ydoc';

/** What the page schema allows, read once from `createPageSchema()` (every lane's blocks). */
export interface SchemaInfo {
  nodes: ReadonlySet<string>;
  marks: ReadonlySet<string>;
  inline: ReadonlySet<string>;
  isSafeUrl: (url: string) => boolean;
}

let cached: SchemaInfo | undefined;

export function pageSchemaInfo(): SchemaInfo {
  if (cached) return cached;
  const schema = createPageSchema();
  const nodes = Object.values(schema.nodes);
  cached = {
    nodes: new Set(nodes.map((type) => type.name)),
    inline: new Set(nodes.filter((type) => type.isInline).map((type) => type.name)),
    marks: new Set(Object.values(schema.marks).map((type) => type.name)),
    isSafeUrl: (url) => LINK_OPTIONS.isAllowedUri(url),
  };
  return cached;
}

/** Attribute names whose values a browser may open or load. */
const URL_KEYS = new Set(['href', 'src', 'url']);
/** Node names that can't appear as blocks. */
const NOT_BLOCKS = new Set(['doc', 'text']);

export type UpdateCheck = { ok: true; blocks: number } | { ok: false; reason: string };

type Where =
  | { kind: 'root'; key: string }
  | { kind: 'element' }
  | { kind: 'text' }
  | { kind: 'gone' }
  | { kind: 'other' };

interface Position {
  where: Where;
  /** The attribute (map key) the item sets, or null for list content. */
  sub: string | null;
}

const GONE: Position = { where: { kind: 'gone' }, sub: null };
const OTHER: Position = { where: { kind: 'other' }, sub: null };

/**
 * Checks a Yjs update before the server applies or relays it (issue #14): only the page's
 * blocks, only node and mark types the schema knows, no embeds or binary content, and only safe
 * addresses in links and `href`/`src`/`url` attributes. `blocks` counts the new elements.
 */
export function checkUpdate(update: Uint8Array, doc: Y.Doc, info: SchemaInfo): UpdateCheck {
  let structs: ReturnType<typeof Y.decodeUpdate>['structs'];
  try {
    structs = Y.decodeUpdate(update).structs;
  } catch {
    return { ok: false, reason: 'unreadable update' };
  }
  const incoming = new Map<number, Y.Item[]>();
  for (const struct of structs) {
    if (!(struct instanceof Y.Item)) continue;
    const list = incoming.get(struct.id.client);
    if (list) list.push(struct);
    else incoming.set(struct.id.client, [struct]);
  }
  const locate = locator(doc, incoming);
  let blocks = 0;
  for (const struct of structs) {
    if (!(struct instanceof Y.Item) || struct.content instanceof Y.ContentDeleted) continue;
    const position = locate(struct);
    const problem = position ? contentProblem(struct.content, position, info) : 'unknown position';
    if (problem) return { ok: false, reason: problem };
    if (struct.content instanceof Y.ContentType && struct.content.type instanceof Y.XmlElement) {
      blocks += 1;
    }
  }
  return { ok: true, blocks };
}

function contentProblem(content: Y.Item['content'], at: Position, info: SchemaInfo): string | null {
  const { where, sub } = at;
  if (where.kind === 'gone') return null; // inside content Yjs already dropped
  if (where.kind === 'root' && where.key !== PAGE_FIELD) return 'unknown field';
  if (sub !== null) {
    if (where.kind !== 'element' || !(content instanceof Y.ContentAny))
      return 'unexpected attribute';
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
  if (!info.marks.has(markName(key))) return false;
  if (value === null) return true;
  return isRecord(value) && Object.entries(value).every(([k, v]) => isSafeValue(k, v, info, 1));
}

/** An attribute value: plain JSON, with only safe addresses under `href`, `src` and `url`. */
export function isSafeValue(key: string, value: unknown, info: SchemaInfo, depth: number): boolean {
  if (typeof value === 'string') return !URL_KEYS.has(key) || info.isSafeUrl(value);
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

  return (item) => {
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
        result = { where: { kind: 'root', key: parent }, sub: current.parentSub };
        break;
      }
      if (parent instanceof Y.AbstractType) {
        result = { where: describe(parent, doc), sub: current.parentSub };
        break;
      }
      if (parent instanceof Y.ID) {
        const owner = find(parent);
        if (owner instanceof Y.GC) result = GONE;
        else if (owner?.content instanceof Y.ContentType) {
          result = { where: describe(owner.content.type, doc), sub: current.parentSub };
        } else result = owner ? OTHER : null;
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
}

function describe(type: unknown, doc: Y.Doc): Where {
  if (type instanceof Y.XmlText) return { kind: 'text' };
  if (type instanceof Y.XmlElement) return { kind: 'element' };
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
