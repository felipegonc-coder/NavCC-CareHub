// Writing help in the page editor: what an action sends, following those words while Claude
// writes, and putting the answer in as one edit by the person (Claude features spec, section 3.2;
// CL-06 to CL-08). Typed by what it uses, so the web app needs none of the editor's packages.
import {
  markdownToBlocks,
  singleParagraph,
  type ClaudeBlock,
} from '@carehub/extras/claude/markdown';
import {
  needsSelection,
  WRITE_LIMITS,
  type WriteAction,
  type WritePlacement,
} from '@carehub/extras/claude/write';

/** A node of the page, as far as writing help reads it (ProseMirror's `Node`). */
export interface PageNode {
  readonly type: { readonly name: string };
  readonly isText: boolean;
  readonly isTextblock: boolean;
  readonly text?: string | undefined;
  readonly nodeSize: number;
  readonly childCount: number;
  child(index: number): PageNode;
}

/** A position in the page with what's around it (ProseMirror's `ResolvedPos`). */
export interface PageSpot {
  readonly depth: number;
  readonly parent: PageNode;
  readonly parentOffset: number;
  start(depth?: number): number;
  end(depth?: number): number;
  before(depth?: number): number;
  after(depth?: number): number;
  node(depth?: number): PageNode;
}

export interface PageDoc extends PageNode {
  resolve(pos: number): PageSpot;
}

export interface PageRange {
  from: number;
  to: number;
}

interface PageChange {
  readonly docChanged: boolean;
  readonly mapping: { map(pos: number, assoc?: number): number };
}

type ChangeHandler = (props: { transaction: PageChange }) => void;

interface EditChain {
  focus(): EditChain;
  insertContentAt(position: number | PageRange, content: unknown): EditChain;
  run(): boolean;
}

/** The page editor (Tiptap's `Editor`), as writing help uses it. */
export interface WriteEditor {
  readonly state: { readonly doc: PageDoc; readonly selection: PageRange };
  readonly isEditable: boolean;
  readonly isDestroyed: boolean;
  chain(): EditChain;
  on(event: 'transaction', handler: ChangeHandler): unknown;
  off(event: 'transaction', handler: ChangeHandler): unknown;
}

/** `value` as the page editor, or null: the menus and Ctrl+J hand it over untyped. */
export function asWriteEditor(value: unknown): WriteEditor | null {
  if (typeof value !== 'object' || value === null) return null;
  const editor = value as Partial<WriteEditor>;
  const state = editor.state as { doc?: Partial<PageDoc> } | undefined;
  const usable =
    typeof editor.chain === 'function' &&
    typeof editor.on === 'function' &&
    typeof editor.off === 'function' &&
    typeof state?.doc?.resolve === 'function';
  return usable ? (value as WriteEditor) : null;
}

/**
 * The page's text from `from` to `to` as the server reads the page: one line per block, a line
 * break as a space, no empty lines, mentions as nothing. The server finds the selection in its
 * copy with this, and takes the text around it from there.
 */
export function pageText(doc: PageNode, from: number, to: number): string {
  const lines: string[] = [];
  let line = '';
  const endLine = () => {
    if (line.trim()) lines.push(line);
    line = '';
  };
  const visit = (node: PageNode, start: number) => {
    let pos = start;
    for (let index = 0; index < node.childCount; index += 1) {
      const child = node.child(index);
      const end = pos + child.nodeSize;
      if (end > from && pos < to) {
        if (child.isText) line += (child.text ?? '').slice(Math.max(from - pos, 0), to - pos);
        else if (child.type.name === 'hardBreak') line += ' ';
        else if (child.isTextblock || child.childCount > 0) {
          endLine();
          visit(child, pos + 1);
          endLine();
        }
      }
      pos = end;
    }
  };
  visit(doc, 0);
  endLine();
  return lines.join('\n');
}

/** The last `count` characters (code points), as the limits count them. */
function lastCharacters(text: string, count: number): string {
  const characters = Array.from(text);
  return characters.length > count ? characters.slice(-count).join('') : text;
}

/** What one action works on and sends. */
export interface WriteTarget {
  readonly action: WriteAction;
  /** The words to rewrite, or the cursor (`from` = `to`). */
  readonly from: number;
  readonly to: number;
  /** Sent as `selection`: those words, or for Continue writing the text above the cursor. */
  readonly selection: string;
  /** About where the words start in the page's text, for when they appear twice. */
  readonly at: number;
  /** There are words Replace can swap. */
  readonly canReplace: boolean;
}

/**
 * The target of `action` for the selection (spec 3.2). With nothing selected, the rewriting
 * actions take the block the cursor is in (section 6) and Summarize takes the whole page, which
 * the server reads itself. Continue writing sends the 4,000 characters above the cursor; Draft
 * sends only what the person types.
 */
export function writeTarget(doc: PageDoc, selection: PageRange, action: WriteAction): WriteTarget {
  const cursor = selection.to;
  if (action === 'draft' || action === 'continue') {
    const above = action === 'continue' ? pageText(doc, 0, cursor) : '';
    return {
      action,
      from: cursor,
      to: cursor,
      selection: lastCharacters(above, WRITE_LIMITS.above),
      at: 0,
      canReplace: false,
    };
  }
  let { from, to } = selection;
  if (from === to && action !== 'summarize') {
    const spot = doc.resolve(from);
    if (spot.parent.isTextblock) {
      from = spot.start();
      to = spot.end();
    }
  }
  const words = from < to ? pageText(doc, from, to) : '';
  return {
    action,
    from,
    to,
    selection: words,
    at: pageText(doc, 0, from).length,
    canReplace: words.trim() !== '',
  };
}

/** Why `target` can't be sent, in words for the menu; null when it can. */
export function targetProblem(target: WriteTarget): string | null {
  return needsSelection(target.action) && !target.canReplace ? 'Select some text first.' : null;
}

/**
 * Follows a target's words through every edit (the person's or a co-editor's) while Claude
 * writes, so the answer lands where they are now, and tells when they changed (CL-08).
 */
export class TrackedTarget {
  from: number;
  to: number;

  constructor(
    private readonly editor: WriteEditor,
    readonly target: WriteTarget,
  ) {
    this.from = target.from;
    this.to = target.to;
    editor.on('transaction', this.onChange);
  }

  private readonly onChange: ChangeHandler = ({ transaction }) => {
    if (!transaction.docChanged) return;
    const { mapping } = transaction;
    if (this.from === this.to) {
      this.from = mapping.map(this.from, -1);
      this.to = this.from;
      return;
    }
    // Text typed just outside the words stays outside them.
    this.from = mapping.map(this.from, 1);
    this.to = Math.max(this.from, mapping.map(this.to, -1));
  };

  get range(): PageRange {
    return { from: this.from, to: this.to };
  }

  /** The words aren't what Claude was given any more, so Replace becomes Insert below. */
  changed(): boolean {
    if (!this.target.canReplace) return false;
    return pageText(this.editor.state.doc, this.from, this.to) !== this.target.selection;
  }

  stop(): void {
    this.editor.off('transaction', this.onChange);
  }
}

/** Whole blocks when the words are exactly whole blocks side by side, so none is left empty. */
function wholeBlocks(doc: PageDoc, range: PageRange): PageRange {
  const start = doc.resolve(range.from);
  const end = doc.resolve(range.to);
  const whole =
    start.parent.isTextblock &&
    end.parent.isTextblock &&
    range.from === start.start() &&
    range.to === end.end() &&
    start.depth === end.depth &&
    start.node(start.depth - 1) === end.node(end.depth - 1);
  return whole ? { from: start.before(), to: end.after() } : range;
}

/** Where Insert below puts blocks: after the block the words end in, or into it when empty. */
function belowPosition(doc: PageDoc, range: PageRange): number {
  let pos = range.to;
  // Words selected up to the start of the next block end before that block.
  if (range.from < range.to && pos > 0 && doc.resolve(pos).parentOffset === 0) pos -= 1;
  const spot = doc.resolve(pos);
  if (spot.depth === 0 || !spot.parent.isTextblock) return pos;
  // An empty line (like the one "/" was typed on) is filled: Tiptap replaces it.
  if (spot.parent.type.name === 'paragraph' && spot.parent.childCount === 0) return pos;
  return spot.after();
}

/**
 * Puts Claude's answer (Markdown) in the page as one edit by the person: one Ctrl+Z takes it
 * back (CL-06). Replace swaps the words, keeping their block when the answer is one paragraph;
 * Insert below adds the answer's blocks after them. False when nothing could go in.
 */
export function applyAnswer(
  editor: WriteEditor,
  range: PageRange,
  answer: string,
  placement: WritePlacement,
): boolean {
  const blocks: ClaudeBlock[] = markdownToBlocks(answer);
  if (blocks.length === 0 || editor.isDestroyed || !editor.isEditable) return false;
  const { doc } = editor.state;
  try {
    if (placement === 'insert_below') {
      return editor.chain().focus().insertContentAt(belowPosition(doc, range), blocks).run();
    }
    if (doc.resolve(range.from).parent.type.name === 'codeBlock') {
      // Code takes plain text only.
      return editor
        .chain()
        .focus()
        .insertContentAt(range, { type: 'text', text: answer.trim() })
        .run();
    }
    const words = singleParagraph(blocks);
    if (words) return editor.chain().focus().insertContentAt(range, words).run();
    return editor.chain().focus().insertContentAt(wholeBlocks(doc, range), blocks).run();
  } catch {
    // The page couldn't take the answer there (say, a list where only text fits).
    return false;
  }
}
