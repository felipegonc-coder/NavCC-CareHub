import { Fragment, type Attrs, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  NodeSelection,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';
import { canJoin, Transform } from '@tiptap/pm/transform';

/**
 * Moving blocks around a page: which block a position belongs to, and the changes that move
 * blocks between others. No DOM here: the keys are in ./block-keys.ts, the handle in
 * ./block-handle.ts.
 */

/** A block that moves as one piece, and the position just before it. */
export interface Block {
  node: ProseMirrorNode;
  pos: number;
}

/** Where blocks dropped on a block go: before it, after it, or nested inside it, at the top. */
export type Place = 'before' | 'after' | 'inside';

const endOf = (block: Block) => block.pos + block.node.nodeSize;

/** Bulleted, numbered and to-do lists: each of their items is a block of its own. */
export const isList = (node: ProseMirrorNode) =>
  (node.type.spec.group ?? '').split(' ').includes('list');

/** Blocks whose first line is their own text even though they may start with any block. */
const TITLED = new Set(['blockquote', 'callout']);

/**
 * Whether `node` is a line with blocks nested under it, like a list item, a to-do, a toggle or a
 * quote: its first child is its own text, so dragging that line drags all of it.
 */
export function hasTitle(node: ProseMirrorNode): boolean {
  const { spec, contentMatch } = node.type;
  if (!node.firstChild?.isTextblock || spec.tableRole || spec.isolating) return false;
  if (TITLED.has(node.type.name)) return true;
  // Its content has to start with a line, as in "paragraph block*".
  if (contentMatch.edgeCount === 0) return false;
  for (let index = 0; index < contentMatch.edgeCount; index += 1) {
    if (!contentMatch.edge(index).type.isTextblock) return false;
  }
  return true;
}

/** The block that starts at `start`, or that the line starting there is the first line of. */
function blockFrom(doc: ProseMirrorNode, start: number): Block | null {
  let pos = start;
  let $pos = doc.resolve(pos);
  // In a table, the whole table: its rows and cells aren't blocks of their own.
  for (let depth = 1; depth <= $pos.depth; depth += 1) {
    if ($pos.node(depth).type.spec.tableRole) {
      pos = $pos.before(depth);
      $pos = doc.resolve(pos);
      break;
    }
  }
  let node = $pos.nodeAfter;
  while (node) {
    if (isList(node)) {
      // A list goes by its first item.
      pos += 1;
    } else if ($pos.depth > 0 && $pos.index() === 0 && hasTitle($pos.parent)) {
      // The first line of a list item, a toggle or a quote: all of it.
      pos = $pos.before();
    } else {
      return { node, pos };
    }
    $pos = doc.resolve(pos);
    node = $pos.nodeAfter;
  }
  return null;
}

/**
 * The block at `pos`: the one that starts there, or else the one around it. A list goes by its
 * first item, a list item, toggle or quote by its first line, and a table is one block.
 */
export function blockAt(doc: ProseMirrorNode, pos: number): Block | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  if ($pos.nodeAfter?.isBlock) return blockFrom(doc, $pos.pos);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).isBlock) return blockFrom(doc, $pos.before(depth));
  }
  // At the end of the page: its last block.
  const last = $pos.nodeBefore;
  return last ? blockFrom(doc, $pos.pos - last.nodeSize) : null;
}

/**
 * `block`, then each block it is the last thing in, innermost first. Right below a nested list,
 * a drop can go after its last item, or after the item the list is nested in, and so on.
 */
export function blocksEndingWith(doc: ProseMirrorNode, block: Block): Block[] {
  const found = [block];
  let $end = doc.resolve(endOf(block));
  while ($end.depth > 0 && $end.pos === $end.end()) {
    if (!isList($end.parent)) {
      const outer = blockFrom(doc, $end.before());
      if (!outer || outer.pos !== $end.before()) break;
      found.push(outer);
    }
    $end = doc.resolve($end.after());
  }
  return found;
}

/** `blocks` in page order, without the ones inside another of them. */
function outermost(blocks: readonly Block[]): Block[] {
  const kept: Block[] = [];
  for (const block of [...blocks].sort((a, b) => a.pos - b.pos)) {
    const last = kept[kept.length - 1];
    if (!last || block.pos >= endOf(last)) kept.push(block);
  }
  return kept;
}

/** The blocks the selection covers, or the block the cursor is in. */
export function selectedBlocks(state: EditorState): Block[] {
  const { doc, selection } = state;
  const range = selection.empty ? null : selection.$from.blockRange(selection.$to);
  if (!range) {
    const block = blockAt(doc, selection.from);
    return block ? [block] : [];
  }
  const found: Block[] = [];
  let pos = range.start;
  for (let index = range.startIndex; index < range.endIndex; index += 1) {
    const child = range.parent.child(index);
    if (isList(child)) {
      // Only the items the selection reaches.
      const start = pos + 1;
      child.forEach((item, offset) => {
        const at = start + offset;
        if (at < selection.to && at + item.nodeSize > selection.from) {
          found.push({ node: item, pos: at });
        }
      });
    } else {
      const block = blockFrom(doc, pos);
      if (block) found.push(block);
    }
    pos += child.nodeSize;
  }
  return outermost(found);
}

/** The position between blocks where blocks dropped `place` of `block` go. */
export function dropPos(block: Block, place: Place): number {
  if (place === 'before') return block.pos;
  if (place === 'after') return endOf(block);
  return block.pos + 1 + (block.node.firstChild?.nodeSize ?? 0);
}

/**
 * Where Ctrl+Shift+↑ (`dir` -1) or ↓ (1) moves `blocks`: past the block next to them, or into it
 * at the near end if blocks are nested in it, or out of the block they are in when they are at
 * its top or bottom. Lists don't count: from the top of a list, blocks move past the block above
 * it. Null at the top or bottom of the page.
 */
export function moveTarget(
  doc: ProseMirrorNode,
  blocks: readonly Block[],
  dir: -1 | 1,
): number | null {
  const moving = outermost(blocks);
  const edge = dir < 0 ? moving[0] : moving[moving.length - 1];
  if (!edge) return null;
  const up = dir < 0;
  let $pos = doc.resolve(up ? edge.pos : endOf(edge));
  // Out of the lists they start or end: lists aren't blocks of their own.
  while (
    $pos.depth > 0 &&
    isList($pos.parent) &&
    $pos.index() === (up ? 0 : $pos.parent.childCount)
  ) {
    $pos = doc.resolve(up ? $pos.before() : $pos.after());
  }
  // Right below the first line of a list item, toggle or quote, or at its end: out of it.
  if ($pos.depth > 0 && hasTitle($pos.parent)) {
    if (up && $pos.index() === 1) return $pos.before();
    if (!up && $pos.index() === $pos.parent.childCount) return $pos.after();
  }
  let next = up ? $pos.nodeBefore : $pos.nodeAfter;
  let pos = up && next ? $pos.pos - next.nodeSize : $pos.pos;
  // A list goes by its last item above, and its first item below.
  if (next && isList(next)) {
    const item = up ? next.lastChild : next.firstChild;
    if (item) pos = up ? $pos.pos - 1 - item.nodeSize : $pos.pos + 1;
    next = item;
  }
  if (!next) return null;
  const neighbour = { node: next, pos };
  // Into a block with blocks nested in it: below them going up, above them going down.
  if (hasTitle(next) && next.childCount > 1) {
    return up ? endOf(neighbour) - 1 : dropPos(neighbour, 'inside');
  }
  return up ? pos : endOf(neighbour);
}

/** A block on the move, and the list it is an item of. */
interface Piece {
  node: ProseMirrorNode;
  list: ProseMirrorNode | null;
}

/** Lists of the same kind: the same type and style (where they start counting doesn't matter). */
function sameList(a: ProseMirrorNode, b: ProseMirrorNode): boolean {
  return (
    a.type === b.type &&
    isList(a) &&
    Object.keys(a.attrs).every((name) => name === 'start' || a.attrs[name] === b.attrs[name])
  );
}

/** The attributes of a new list of the same kind as `list`, which counts from the start. */
function restarted(list: ProseMirrorNode): Attrs {
  const start: unknown = list.type.spec.attrs?.start?.default;
  return start === undefined ? list.attrs : { ...list.attrs, start };
}

/** The pieces as blocks: list items go in a list of the kind they came from, side by side. */
function asBlocks(pieces: readonly Piece[]): { node: ProseMirrorNode; wrapped: boolean }[] {
  const blocks: { node: ProseMirrorNode; wrapped: boolean }[] = [];
  let previous: ProseMirrorNode | null = null;
  for (const { node, list } of pieces) {
    const last = blocks[blocks.length - 1];
    if (list && previous && last?.wrapped && sameList(previous, list)) {
      last.node = last.node.copy(last.node.content.addToEnd(node));
    } else if (list) {
      blocks.push({ node: list.type.create(restarted(list), node), wrapped: true });
    } else {
      blocks.push({ node, wrapped: false });
    }
    previous = list;
  }
  return blocks;
}

/**
 * Puts `pieces` at `at`, a position between blocks. Items of the kind of list that's there go
 * straight in; anything else splits the list and goes between its two parts. Returns where each
 * piece starts and the range that was added, or null if they can't go there.
 */
function insertPieces(
  tr: Transform,
  at: number,
  pieces: readonly Piece[],
): { starts: number[]; from: number; to: number } | null {
  let pos = at;
  let $pos = tr.doc.resolve(pos);
  const list = $pos.parent;
  if (isList(list)) {
    if (pieces.every((piece) => piece.list?.type === list.type)) {
      const items = Fragment.from(pieces.map((piece) => piece.node));
      if (!list.canReplace($pos.index(), $pos.index(), items)) return null;
      tr.insert(pos, items);
      const starts: number[] = [];
      items.forEach((_item, offset) => starts.push(pos + offset));
      return { starts, from: pos, to: pos + items.size };
    }
    const index = $pos.index();
    if (index === 0) pos = $pos.before();
    else if (index === list.childCount) pos = $pos.after();
    else {
      tr.split(pos, 1, [{ type: list.type, attrs: restarted(list) }]);
      pos += 1;
    }
    $pos = tr.doc.resolve(pos);
  }
  const blocks = asBlocks(pieces);
  const content = Fragment.from(blocks.map((block) => block.node));
  if (!$pos.parent.canReplace($pos.index(), $pos.index(), content)) return null;
  tr.insert(pos, content);
  const starts: number[] = [];
  let offset = pos;
  for (const block of blocks) {
    if (block.wrapped) block.node.forEach((_item, inner) => starts.push(offset + 1 + inner));
    else starts.push(offset);
    offset += block.node.nodeSize;
  }
  return { starts, from: pos, to: offset };
}

/**
 * Joins the two lists that meet at `pos` if they are of the same kind, and says if it did. The
 * joined list counts like the first one, or like the second with `asSecond`.
 */
function joinLists(tr: Transform, pos: number, asSecond = false): boolean {
  const { nodeBefore, nodeAfter } = tr.doc.resolve(pos);
  if (!nodeBefore || !nodeAfter || !sameList(nodeBefore, nodeAfter) || !canJoin(tr.doc, pos)) {
    return false;
  }
  if (asSecond) tr.setNodeMarkup(pos - nodeBefore.nodeSize, null, nodeAfter.attrs);
  tr.join(pos);
  return true;
}

/** Whether nothing lies between `from` and `to` but the edges of nodes, like a list's start. */
function nothingBetween(doc: ProseMirrorNode, from: number, to: number): boolean {
  let found = false;
  doc.nodesBetween(from, to, (node, pos) => {
    if (pos >= from && pos + node.nodeSize <= to) found = true;
    return !found;
  });
  return !found;
}

/**
 * Whether blocks dropped at `target` stay where they are: it is right before, after or between
 * them (they are side by side), or just outside a list that starts or ends with them.
 */
function inPlace(doc: ProseMirrorNode, moving: readonly Block[], target: number): boolean {
  const first = moving[0];
  const last = moving[moving.length - 1];
  if (!first || !last) return false;
  let $start = doc.resolve(first.pos);
  while ($start.depth > 0 && isList($start.parent) && $start.index() === 0) {
    $start = doc.resolve($start.before());
  }
  let $end = doc.resolve(endOf(last));
  while ($end.depth > 0 && isList($end.parent) && $end.index() === $end.parent.childCount) {
    $end = doc.resolve($end.after());
  }
  if (target < $start.pos || target > $end.pos) return false;
  return moving.every((block, index) => {
    const previous = moving[index - 1];
    return !previous || nothingBetween(doc, endOf(previous), block.pos);
  });
}

export interface MoveOptions {
  /** Copies the blocks instead of moving them (an editor gives the copies new block IDs). */
  copy?: boolean;
}

/**
 * Moves `blocks` to `target`, a position between blocks (or with `copy`, copies them there), in
 * `tr`. Moved blocks keep their IDs. A list item that lands outside a list gets a list of its own
 * kind, anything else that lands among the items of a list splits it, and lists of the same kind
 * that end up side by side join. Returns the blocks where they landed, or null, leaving `tr` as
 * it was, when they can't go there (like into one of themselves).
 */
export function moveBlocks(
  tr: Transaction,
  blocks: readonly Block[],
  target: number,
  options: MoveOptions = {},
): Block[] | null {
  const moving = outermost(blocks);
  if (moving.length === 0) return null;
  if (moving.some((block) => target > block.pos && target < endOf(block))) return null;
  const { doc } = tr;
  // Dropped next to themselves: nothing changes.
  if (!options.copy && inPlace(doc, moving, target)) return moving;
  const pieces = moving.map(({ node, pos }): Piece => {
    const parent = doc.resolve(pos).parent;
    return { node, list: isList(parent) ? parent : null };
  });
  const change = new Transform(doc);
  if (!options.copy) {
    // Last first, so the positions of the others stay as they are.
    for (const block of [...moving].reverse()) change.deleteRange(block.pos, endOf(block));
  }
  const added = insertPieces(change, change.mapping.map(target), pieces);
  if (!added) return null;
  // Where blocks left and where they landed, lists of the same kind may now meet.
  const left = options.copy ? [] : moving.map((block) => change.mapping.map(block.pos));
  const joined = change.steps.length;
  const join = (pos: number, asSecond = false) =>
    joinLists(change, change.mapping.slice(joined).map(pos), asSecond);
  for (const pos of left) join(pos);
  // A list that was there keeps counting as it did, even when the added one comes first.
  const joinedBefore = join(added.from);
  join(added.to, !joinedBefore);
  const after = change.mapping.slice(joined);
  const landed: Block[] = [];
  for (const start of added.starts) {
    const pos = after.map(start, 1);
    const node = change.doc.nodeAt(pos);
    if (node) landed.push({ node, pos });
  }
  for (const step of change.steps) tr.step(step);
  return landed;
}

/**
 * Adds an empty line at `pos`, a position between blocks (splitting a list if it's in one).
 * Returns the position of the new line, or null if a line can't go there.
 */
export function insertLine(tr: Transaction, pos: number): number | null {
  const line = tr.doc.type.schema.nodes.paragraph?.create();
  if (!line) return null;
  const change = new Transform(tr.doc);
  const added = insertPieces(change, pos, [{ node: line, list: null }]);
  const start = added?.starts[0];
  if (start === undefined) return null;
  for (const step of change.steps) tr.step(step);
  return start;
}

/**
 * A selection in blocks that just landed: the end of the first one's first line, or the whole
 * block when it has no text (like a divider).
 */
export function selectionIn(doc: ProseMirrorNode, blocks: readonly Block[]): Selection | null {
  const first = blocks[0];
  if (!first) return null;
  const text = first.node.isAtom ? null : Selection.findFrom(doc.resolve(first.pos), 1, true);
  if (text && text.from < endOf(first)) return TextSelection.create(doc, text.$from.end());
  return NodeSelection.create(doc, first.pos);
}

interface UndoPluginState {
  undoManager?: { stopCapturing?: () => void };
}

/**
 * Starts a new undo step, so that the next change undoes on its own: the Yjs undo manager joins
 * changes made within half a second of each other, like typing and then dragging a block.
 */
export function newUndoStep(state: EditorState) {
  for (const plugin of state.plugins) {
    (plugin.getState(state) as UndoPluginState | undefined)?.undoManager?.stopCapturing?.();
  }
}
