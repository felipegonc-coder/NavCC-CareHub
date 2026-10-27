import { Extension, getSchema, type Extensions, type JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';

/** The attribute that holds a block's ID. Stored data: never rename it. */
export const BLOCK_ID = 'blockId';

interface RandomSource {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

/** A new block ID: a random UUID (version 4). */
export function newBlockId(): string {
  // Typed by what it uses, so the schema needs no DOM or Node types (the server loads it too).
  const random = (globalThis as unknown as { crypto?: RandomSource }).crypto;
  if (random?.randomUUID) return random.randomUUID();
  // Outside HTTPS, browsers have getRandomValues but not randomUUID.
  const bytes = new Uint8Array(16).map(() => Math.floor(Math.random() * 256));
  random?.getRandomValues?.(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return hex.replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
}

/** A block's ID, or null if it has none (yet). */
export function blockIdOf(node: ProseMirrorNode): string | null {
  const id: unknown = node.attrs[BLOCK_ID];
  return typeof id === 'string' && id !== '' ? id : null;
}

/**
 * The node types that get a block ID: every line (paragraphs, headings and code blocks, also in
 * lists, to-do items and quotes) and every block that is one piece, like a divider or a lane's
 * database. Lists, list items and quotes have none of their own: a list item goes by its first
 * line, so turning a line into a list item or a quote and back keeps its ID.
 */
export function blockIdTypes(extensions: Extensions): string[] {
  return Object.values(getSchema(extensions).nodes)
    .filter((type) => type.isBlock && (type.isTextblock || type.isAtom))
    .map((type) => type.name);
}

/**
 * The ID of the block at `pos`: the block that starts there (a list counts as its first line),
 * or else the line or block that holds `pos`. Null if it has none yet.
 */
export function blockIdAt(doc: ProseMirrorNode, pos: number): string | null {
  for (let node = doc.nodeAt(pos); node?.isBlock; node = node.firstChild) {
    const id = blockIdOf(node);
    if (id) return id;
  }
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const id = blockIdOf($pos.node(depth));
    if (id) return id;
  }
  return null;
}

/** The block with this ID, and the position just before it; null if the page has none. */
export function findBlock(
  doc: ProseMirrorNode,
  blockId: string,
): { node: ProseMirrorNode; pos: number } | null {
  let found: { node: ProseMirrorNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (blockIdOf(node) === blockId) found = { node, pos };
    return !found && !node.isTextblock;
  });
  return found;
}

/** A copy of `content` where every block `hasId` allows has an ID of its own. */
export function assignBlockIds(
  content: JSONContent,
  hasId: (type: string) => boolean,
): JSONContent {
  const seen = new Set<string>();
  const visit = (node: JSONContent): JSONContent => {
    const copy: JSONContent = { ...node };
    if (node.type && hasId(node.type)) {
      const id: unknown = node.attrs?.[BLOCK_ID];
      const blockId = typeof id === 'string' && id !== '' && !seen.has(id) ? id : newBlockId();
      seen.add(blockId);
      copy.attrs = { ...node.attrs, [BLOCK_ID]: blockId };
    }
    if (node.content) copy.content = node.content.map(visit);
    return copy;
  };
  return visit(content);
}

/** Transactions that bring changes from the Y.Doc: other people's, undo and redo, loading. */
function fromYjs(state: EditorState): (tr: Transaction) => boolean {
  const sync = state.plugins.find((plugin) =>
    String((plugin as unknown as { key?: unknown }).key).startsWith('y-sync$'),
  );
  return (tr) => sync !== undefined && tr.getMeta(sync) !== undefined;
}

/** Of the blocks that share an ID, the one that keeps it. */
function keeper(
  holders: number[],
  doc: ProseMirrorNode,
  old: { node: ProseMirrorNode; pos: number } | null,
  back: Mapping | null,
): number | undefined {
  if (!old) return holders[0];
  // Enter at the start of a line: the part with the text keeps the ID.
  const text = old.node.textContent;
  const sameText = text ? holders.filter((pos) => doc.nodeAt(pos)?.textContent === text) : [];
  if (sameText.length === 1) return sameText[0];
  // A line split in two, or a copy of a block: the block that was already there keeps the ID.
  const stayed = holders.find((pos) => {
    const result = back?.mapResult(pos, 1);
    return result?.pos === old.pos && !result.deleted;
  });
  return stayed ?? holders[0];
}

/**
 * Gives IDs to the blocks your own changes made or touched: new blocks get new IDs, and so does
 * every copy (pasted blocks, the copy in a duplicate, the second part of a split line). A block
 * that only changed type keeps its ID.
 */
function fillBlockIds(
  transactions: readonly Transaction[],
  before: ProseMirrorNode,
  state: EditorState,
  types: ReadonlySet<string>,
): Transaction | null {
  const isFromYjs = fromYjs(state);
  if (!transactions.some((tr) => tr.docChanged && !isFromYjs(tr))) return null;
  const { doc } = state;
  // An empty page's line gets its ID with the first thing typed.
  const only = doc.childCount === 1 ? doc.firstChild : null;
  if (only?.isTextblock && only.content.size === 0) return null;

  // The ranges your changes touched, in today's positions, and the way back to the old ones.
  const ranges: { from: number; to: number }[] = [];
  const mapping = new Mapping();
  for (const tr of transactions) {
    const mine = !isFromYjs(tr);
    for (const map of tr.mapping.maps) {
      for (const range of ranges) {
        range.from = map.map(range.from, -1);
        range.to = map.map(range.to, 1);
      }
      if (mine) map.forEach((_oldFrom, _oldTo, from, to) => ranges.push({ from, to }));
      mapping.appendMap(map);
    }
  }
  const back = transactions.some(isFromYjs) ? null : mapping.invert();
  const copied = transactions.some((tr) =>
    ['paste', 'drop'].includes(String(tr.getMeta('uiEvent'))),
  );

  const missing = new Set<number>();
  const placed = new Set<string>();
  for (const { from, to } of ranges) {
    doc.nodesBetween(Math.max(0, from), Math.min(to, doc.content.size), (node, pos) => {
      if (types.has(node.type.name)) {
        const id = blockIdOf(node);
        if (id === null) missing.add(pos);
        else if (pos >= from) placed.add(id);
      }
      return !node.isTextblock;
    });
  }
  if (missing.size === 0 && placed.size === 0) return null;

  const holders = new Map<string, number[]>();
  doc.descendants((node, pos) => {
    const id = blockIdOf(node);
    const list = id === null ? null : holders.get(id);
    if (list) list.push(pos);
    else if (id !== null) holders.set(id, [pos]);
    return !node.isTextblock;
  });
  const changes = new Map<number, string>();
  for (const id of placed) {
    const shared = holders.get(id) ?? [];
    if (shared.length < 2) continue;
    const keep = keeper(shared, doc, findBlock(before, id), back);
    for (const pos of shared) if (pos !== keep) changes.set(pos, newBlockId());
  }
  const reused = new Set<string>();
  for (const pos of missing) {
    // A block remade as another type (a heading from a Markdown shortcut) keeps the old ID.
    const old = back && !copied ? before.nodeAt(back.map(pos, 1)) : null;
    const id = old ? blockIdOf(old) : null;
    const keepId = id !== null && !holders.has(id) && !reused.has(id);
    if (keepId) reused.add(id);
    changes.set(pos, keepId ? id : newBlockId());
  }

  if (changes.size === 0) return null;
  const { tr } = state;
  for (const [pos, id] of changes) tr.setNodeAttribute(pos, BLOCK_ID, id);
  return tr;
}

export interface BlockIdsOptions {
  /** The node types that get IDs (see `blockIdTypes`). */
  types: string[];
}

const blockIdsKey = new PluginKey('blockIds');

/**
 * The `blockId` of every line and one-piece block: a UUID, stored as an attribute of its Y.Doc
 * element and drawn as `data-block-id`. Never read from HTML, so pasted blocks get new IDs (cut
 * and paste counts as a copy); drag and drop, Turn into and undo keep them. An editable editor
 * fills them in for your own changes; other people's editors fill in theirs.
 */
export const BlockIds = Extension.create<BlockIdsOptions>({
  name: 'blockIds',

  addOptions() {
    return { types: [] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          [BLOCK_ID]: {
            default: null,
            keepOnSplit: false,
            parseHTML: () => null,
            renderHTML: (attributes: Record<string, unknown>) => {
              const id: unknown = attributes[BLOCK_ID];
              return typeof id === 'string' ? { 'data-block-id': id } : {};
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const { editor } = this;
    const types = new Set(this.options.types);
    return [
      new Plugin({
        key: blockIdsKey,
        appendTransaction: (transactions, before, state) =>
          editor.isEditable ? fillBlockIds(transactions, before.doc, state, types) : null,
      }),
    ];
  },
});
