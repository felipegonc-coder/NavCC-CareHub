// Show changes (HT-04): what's different between a version and the one before it. Blocks are
// compared whole; blocks of the same type that changed are compared inside, the blocks of a list
// or quote one by one and the text of a paragraph word by word.
import type { HistoryDoc, HistoryNode } from './kinds';

export type BlockChange = 'same' | 'added' | 'removed' | 'changed';
export type TextChange = 'same' | 'added' | 'removed';

/** A run of text (with its marks) or an inline node, such as a line break or a mention. */
export interface TextPiece {
  change: TextChange;
  node: HistoryNode;
}

export interface DiffBlock {
  change: BlockChange;
  /** The block as the version has it; a removed block as the version before had it. */
  node: HistoryNode;
  /** A changed block holding blocks (a list, a quote, a table): its blocks, compared. */
  blocks?: DiffBlock[];
  /** A changed text block (a paragraph, a heading): its text, compared word by word. */
  pieces?: TextPiece[];
}

/** Bigger comparisons than this many steps show the middle as removed, then added. */
const MAX_STEPS = 1_000_000;
const INLINE_TYPES = new Set(['text', 'hardBreak', 'mention', 'emoji', 'inlineMath', 'date']);
const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock']);
const TOKENS = /\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}_'’]/gu;

const isInline = (node: HistoryNode) => node.type === 'text' || INLINE_TYPES.has(node.type);
const isTextBlock = (node: HistoryNode) =>
  node.content ? node.content.every(isInline) : TEXT_BLOCKS.has(node.type);
const keyOf = (node: HistoryNode) => JSON.stringify(node);

/**
 * Pairs equal items of `a` and `b` (by `key`), keeping their order: the longest common
 * subsequence, after the common start and end. Gives each item's partner index, or -1.
 */
function match(a: readonly string[], b: readonly string[]): { inA: number[]; inB: number[] } {
  const inA = a.map(() => -1);
  const inB = b.map(() => -1);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    inA[start] = start;
    inB[start] = start;
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
    inA[endA] = endB;
    inB[endB] = endA;
  }
  const rows = endA - start;
  const cols = endB - start;
  if (rows === 0 || cols === 0 || rows * cols > MAX_STEPS) return { inA, inB };
  // lengths[i][j]: the longest common subsequence of a[start + i..] and b[start + j..].
  const width = cols + 1;
  const lengths = new Uint32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        a[start + i] === b[start + j]
          ? (lengths[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(lengths[(i + 1) * width + j] ?? 0, lengths[i * width + j + 1] ?? 0);
    }
  }
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (a[start + i] === b[start + j]) {
      inA[start + i] = start + j;
      inB[start + j] = start + i;
      i += 1;
      j += 1;
    } else if ((lengths[(i + 1) * width + j] ?? 0) >= (lengths[i * width + j + 1] ?? 0)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return { inA, inB };
}

/** Walks two matched lists in order: `pair` for matched items, `gap` for what lies between. */
function walk<T>(
  before: readonly T[],
  after: readonly T[],
  keys: { before: readonly string[]; after: readonly string[] },
  pair: (old: T, current: T) => void,
  gap: (removed: T[], added: T[]) => void,
): void {
  const { inA, inB } = match(keys.before, keys.after);
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    const removed: T[] = [];
    const added: T[] = [];
    while (i < before.length && inA[i] === -1) removed.push(before[i++] as T);
    while (j < after.length && inB[j] === -1) added.push(after[j++] as T);
    if (removed.length || added.length) gap(removed, added);
    if (i < before.length && j < after.length) pair(before[i++] as T, after[j++] as T);
  }
}

/** Compares two lists of blocks. */
export function diffBlocks(
  before: readonly HistoryNode[],
  after: readonly HistoryNode[],
): DiffBlock[] {
  const out: DiffBlock[] = [];
  walk(
    before,
    after,
    { before: before.map(keyOf), after: after.map(keyOf) },
    (_old, node) => out.push({ change: 'same', node }),
    (removed, added) => {
      // Blocks at the same place in the gap with the same type changed; the others came or went.
      const paired = Math.min(removed.length, added.length);
      for (let k = 0; k < paired; k += 1) {
        const old = removed[k] as HistoryNode;
        const node = added[k] as HistoryNode;
        if (old.type === node.type) out.push(changedBlock(old, node));
        else out.push({ change: 'removed', node: old }, { change: 'added', node });
      }
      for (const node of removed.slice(paired)) out.push({ change: 'removed', node });
      for (const node of added.slice(paired)) out.push({ change: 'added', node });
    },
  );
  return out;
}

function changedBlock(old: HistoryNode, node: HistoryNode): DiffBlock {
  if (isTextBlock(old) && isTextBlock(node)) {
    return { change: 'changed', node, pieces: diffText(old.content ?? [], node.content ?? []) };
  }
  if (old.content && node.content) {
    return { change: 'changed', node, blocks: diffBlocks(old.content, node.content) };
  }
  return { change: 'changed', node };
}

type Token = { key: string; node: HistoryNode };

/** Words, spaces and punctuation of text runs, with their marks; other inline nodes whole. */
function tokens(inline: readonly HistoryNode[]): Token[] {
  return inline.flatMap((node): Token[] => {
    if (node.type !== 'text') return [{ key: `\u0000${keyOf(node)}`, node }];
    return (node.text?.match(TOKENS) ?? []).map((text) => ({ key: text, node: { ...node, text } }));
  });
}

/** Compares the text of two text blocks word by word; marks alone don't count as changes. */
export function diffText(
  before: readonly HistoryNode[],
  after: readonly HistoryNode[],
): TextPiece[] {
  const old = tokens(before);
  const current = tokens(after);
  const pieces: TextPiece[] = [];
  const push = (change: TextChange, node: HistoryNode) => {
    const last = pieces[pieces.length - 1];
    if (
      last?.change === change &&
      last.node.type === 'text' &&
      node.type === 'text' &&
      JSON.stringify(last.node.marks ?? []) === JSON.stringify(node.marks ?? [])
    ) {
      last.node = { ...last.node, text: `${last.node.text ?? ''}${node.text ?? ''}` };
    } else {
      pieces.push({ change, node });
    }
  };
  walk(
    old,
    current,
    { before: old.map((one) => one.key), after: current.map((one) => one.key) },
    (_was, token) => push('same', token.node),
    (removed, added) => {
      for (const token of removed) push('removed', token.node);
      for (const token of added) push('added', token.node);
    },
  );
  return pieces;
}

/** Show changes for a version: compared with the version before it (null: nothing to compare). */
export function diffDocs(before: HistoryDoc | null, after: HistoryDoc): DiffBlock[] {
  if (!before) return after.content.map((node) => ({ change: 'same', node }));
  return diffBlocks(before.content, after.content);
}

/** How many blocks changed, came or went: "3 changes" in Updates. */
export function countChanges(blocks: readonly DiffBlock[]): number {
  return blocks.filter((block) => block.change !== 'same').length;
}
