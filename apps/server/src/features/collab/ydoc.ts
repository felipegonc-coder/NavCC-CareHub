import { PAGE_FIELD } from '@carehub/editor/schema';
import * as Y from 'yjs';

/** A block, inline node or text run, shaped like ProseMirror JSON. */
export interface PageNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PageNode[];
  text?: string;
  marks?: PageMark[];
}

export interface PageMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface DeltaOp {
  insert?: unknown;
  attributes?: Record<string, unknown>;
}

/**
 * How deep blocks may nest; `checkUpdate` refuses deeper ones. Anything deeper (in a document
 * from before that check) is read as leaves, so a hostile document can't exhaust the stack.
 */
export const MAX_DEPTH = 100;

/** y-prosemirror stores marks that may repeat (like comments) as `name--<hash>`. */
const HASHED_MARK = /^(.+)--[A-Za-z0-9+/=]{8}$/;

export function markName(key: string): string {
  return HASHED_MARK.exec(key)?.[1] ?? key;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
  );
}

export function pageFragment(doc: Y.Doc): Y.XmlFragment {
  return doc.getXmlFragment(PAGE_FIELD);
}

/** The page's blocks as ProseMirror-style JSON. */
export function readContent(doc: Y.Doc): PageNode[] {
  return readChildren(pageFragment(doc), 0);
}

function readChildren(parent: Y.XmlFragment, depth: number): PageNode[] {
  const nodes: PageNode[] = [];
  if (depth > MAX_DEPTH) return nodes;
  for (const child of parent.toArray()) {
    if (child instanceof Y.XmlText) nodes.push(...readText(child));
    else if (child instanceof Y.XmlElement) nodes.push(readElement(child, depth));
  }
  return nodes;
}

function readElement(element: Y.XmlElement, depth: number): PageNode {
  const node: PageNode = { type: element.nodeName };
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(element.getAttributes())) {
    if (value !== null && value !== undefined) attrs[key] = value;
  }
  if (Object.keys(attrs).length > 0) node.attrs = attrs;
  const content = readChildren(element, depth + 1);
  if (content.length > 0) node.content = content;
  return node;
}

function readText(text: Y.XmlText): PageNode[] {
  const nodes: PageNode[] = [];
  for (const op of text.toDelta() as DeltaOp[]) {
    if (typeof op.insert !== 'string' || op.insert === '') continue;
    const node: PageNode = { type: 'text', text: op.insert };
    const marks: PageMark[] = [];
    for (const [key, value] of Object.entries(op.attributes ?? {})) {
      if (value === null || value === undefined) continue;
      const type = markName(key);
      marks.push(
        isRecord(value) && Object.keys(value).length > 0 ? { type, attrs: value } : { type },
      );
    }
    if (marks.length > 0) node.marks = marks;
    nodes.push(node);
  }
  return nodes;
}

/** Y types for `nodes`, laid out the way y-prosemirror lays them out. */
export function toYNodes(nodes: readonly PageNode[]): Array<Y.XmlElement | Y.XmlText> {
  const out: Array<Y.XmlElement | Y.XmlText> = [];
  let run: PageNode[] = [];
  const flush = () => {
    if (run.length > 0) out.push(toYText(run));
    run = [];
  };
  for (const node of nodes) {
    if (node.type === 'text') {
      if (node.text) run.push(node);
      continue;
    }
    flush();
    const element = new Y.XmlElement(node.type);
    for (const [key, value] of Object.entries(node.attrs ?? {})) {
      if (value !== null && value !== undefined) element.setAttribute(key, value as never);
    }
    const children = toYNodes(node.content ?? []);
    if (children.length > 0) element.insert(0, children);
    out.push(element);
  }
  flush();
  return out;
}

function toYText(run: readonly PageNode[]): Y.XmlText {
  const text = new Y.XmlText();
  // Every run gets an explicit attributes object, so it never inherits marks from the run before.
  text.applyDelta(
    run.map((node) => ({
      insert: node.text ?? '',
      attributes: Object.fromEntries(
        (node.marks ?? []).map((mark) => [mark.type, mark.attrs ?? {}]),
      ),
    })),
  );
  return text;
}

/** Replaces the page's blocks with `nodes`, as ordinary changes that merge with live edits. */
export function replaceContent(
  doc: Y.Doc,
  nodes: readonly PageNode[],
  origin: unknown = null,
): void {
  const fragment = pageFragment(doc);
  doc.transact(() => {
    if (fragment.length > 0) fragment.delete(0, fragment.length);
    const children = toYNodes(nodes);
    if (children.length > 0) fragment.insert(0, children);
  }, origin);
}

/** Blocks as people count them: every block that holds no other blocks. */
export function countBlocks(doc: Y.Doc, inline: ReadonlySet<string>): number {
  let count = 0;
  const visit = (parent: Y.XmlFragment, depth: number): boolean => {
    let hasBlocks = false;
    for (const child of parent.toArray()) {
      if (!(child instanceof Y.XmlElement) || inline.has(child.nodeName)) continue;
      hasBlocks = true;
      if (depth >= MAX_DEPTH || !visit(child, depth + 1)) count += 1;
    }
    return hasBlocks;
  };
  visit(pageFragment(doc), 0);
  return count;
}

/**
 * Plain text for search: each block's text on its own line. Mentions, page links and other atoms
 * add nothing, so other pages' titles never leak into this page's copy (issue #14).
 */
export function toText(nodes: readonly PageNode[]): string {
  const lines: string[] = [];
  const visit = (list: readonly PageNode[]) => {
    let line = '';
    for (const node of list) {
      if (node.type === 'text') line += node.text ?? '';
      else if (node.type === 'hardBreak') line += ' ';
      else if (node.content) {
        if (line.trim()) lines.push(line);
        line = '';
        visit(node.content);
      }
    }
    if (line.trim()) lines.push(line);
  };
  visit(nodes);
  return lines.join('\n');
}
