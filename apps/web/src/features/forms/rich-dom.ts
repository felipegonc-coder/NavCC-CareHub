/**
 * Rich text on the page, for the builder's description editor: drawing it (with the same look as
 * the fill screen), reading it back after the browser edits it, mapping the selection to
 * character offsets, and reading pasted HTML (keeping bold, italic, underline, our colours and
 * safe links; dropping all other formatting).
 */
import type { Mention, RichText, RichTextSpan, TextColor, TextMark } from '@carehub/databases';
import { isSafeLink, normalizeRichText, plainText, sanitizeRichText } from '@carehub/databases';
import type { TextRange } from './rich-model';
import { tidyLines } from './rich-model';
import { LINK_CLASS, MARK_LOOKS, colorClass, readColor } from './rich-style';

// ------------------------------------------------------------------ drawing

function spanNode(doc: Document, span: RichTextSpan): Node {
  if (span.mention) {
    const el = doc.createElement('span');
    el.setAttribute('contenteditable', 'false');
    el.dataset.mention = JSON.stringify(span.mention);
    el.textContent = span.text;
    return el;
  }
  let node: Node = doc.createTextNode(span.text);
  for (const look of MARK_LOOKS) {
    if (!span.marks?.includes(look.mark)) continue;
    const el = doc.createElement(look.tag);
    if (look.className) el.className = look.className;
    el.append(node);
    node = el;
  }
  const color = colorClass(span.color);
  if (color && span.color) {
    const el = doc.createElement('span');
    el.className = color;
    el.dataset.color = span.color;
    el.append(node);
    node = el;
  }
  if (span.link && isSafeLink(span.link)) {
    const a = doc.createElement('a');
    a.setAttribute('href', span.link);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.className = LINK_CLASS;
    a.append(node);
    node = a;
  }
  return node;
}

/**
 * Replaces what's inside `root` with the text. A final line break gets a <br> after it so the
 * empty last line shows and can hold the caret; reading back ignores it.
 */
export function drawRichText(root: HTMLElement, rt: RichText): void {
  const doc = root.ownerDocument;
  const nodes = rt.map((span) => spanNode(doc, span));
  if (plainText(rt).endsWith('\n')) nodes.push(doc.createElement('br'));
  root.replaceChildren(...nodes);
}

/** True when `root` holds exactly what drawRichText would draw for the text. */
export function isDrawnAs(root: HTMLElement, rt: RichText): boolean {
  const scratch = root.ownerDocument.createElement('div');
  drawRichText(scratch, rt);
  return scratch.innerHTML === root.innerHTML;
}

// ------------------------------------------------------------------ reading

interface Context {
  marks: ReadonlySet<TextMark>;
  color?: TextColor | undefined;
  link?: string | undefined;
  /** Inside <pre> or white-space: pre (pasted HTML only). */
  pre: boolean;
}

const BLOCKS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TR',
  'UL',
]);

/** Never text: scripts, styles and the like. */
const SKIPPED = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'NOSCRIPT',
  'HEAD',
  'TITLE',
  'META',
  'LINK',
  'IFRAME',
  'OBJECT',
  'SVG',
  'MATH',
  'svg',
  'math',
]);

const TAG_MARKS: Record<string, TextMark> = {
  B: 'bold',
  STRONG: 'bold',
  I: 'italic',
  EM: 'italic',
  U: 'underline',
  INS: 'underline',
  S: 'strike',
  STRIKE: 'strike',
  DEL: 'strike',
  CODE: 'code',
};

function weightIsBold(weight: string): boolean | null {
  if (weight === 'bold' || weight === 'bolder') return true;
  if (weight === 'normal' || weight === 'lighter') return false;
  const n = Number(weight);
  return weight !== '' && Number.isFinite(n) ? n >= 600 : null;
}

/** The formatting inside `el`, from its tag, its inline style and our data attributes. */
function enter(el: Element, outer: Context): Context {
  const marks = new Set(outer.marks);
  const tagMark = TAG_MARKS[el.tagName];
  if (tagMark) marks.add(tagMark);
  const style = (el as HTMLElement).style as CSSStyleDeclaration | undefined;
  let pre = outer.pre || el.tagName === 'PRE';
  if (style) {
    const bold = weightIsBold(style.fontWeight ?? '');
    if (bold === true) marks.add('bold');
    if (bold === false) marks.delete('bold');
    if (style.fontStyle === 'italic' || style.fontStyle === 'oblique') marks.add('italic');
    if (style.fontStyle === 'normal') marks.delete('italic');
    const decoration = `${style.textDecoration ?? ''} ${style.textDecorationLine ?? ''}`;
    if (decoration.includes('underline')) marks.add('underline');
    if (decoration.includes('line-through')) marks.add('strike');
    const space = style.whiteSpace ?? '';
    if (space.startsWith('pre') || space === 'break-spaces') pre = true;
    if (space === 'normal' || space === 'nowrap') pre = false;
  }
  const next: Context = { marks, color: outer.color, link: outer.link, pre };
  const color = el.getAttribute('data-color');
  if (color && readColor(color)) next.color = color as TextColor;
  if (el.tagName === 'A') {
    const href = el.getAttribute('href') ?? '';
    if (isSafeLink(href)) next.link = href;
  }
  return next;
}

function readMention(el: Element): Mention | null {
  try {
    const parsed: unknown = JSON.parse(el.getAttribute('data-mention') ?? '');
    const checked = sanitizeRichText([{ text: 'x', mention: parsed }], 1);
    return checked?.[0]?.mention ?? null;
  } catch {
    return null;
  }
}

/** The last text, <br> or mention inside root: a <br> there draws no line, so it isn't one. */
function lastLeaf(root: Node): Node | null {
  let node: Node | null = root.lastChild;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE && (node as Text).data !== '') return node;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.nodeName === 'BR' || el.hasAttribute('data-mention')) return node;
      if (el.lastChild && !SKIPPED.has(el.nodeName)) {
        node = el.lastChild;
        continue;
      }
    }
    while (node && node !== root && !node.previousSibling) node = node.parentNode;
    if (!node || node === root) return null;
    node = node.previousSibling;
  }
  return null;
}

interface ReadOptions {
  /** Pasted from elsewhere: collapse spaces like a browser and keep only the toolbar's formatting. */
  pasted: boolean;
  /** Stop reading after about this many characters. */
  limit?: number;
}

function read(root: Node, options: ReadOptions): RichText {
  const out: RichTextSpan[] = [];
  let length = 0;
  let lastChar = '';
  let breakBefore = false;
  const trailing = lastLeaf(root);
  const push = (text: string, ctx: Context, mention?: Mention) => {
    if (breakBefore && length > 0 && lastChar !== '\n') {
      out.push({ text: '\n' });
      length += 1;
      lastChar = '\n';
    }
    breakBefore = false;
    const span: RichTextSpan = { text };
    const marks = [...ctx.marks].filter(
      (m) => !options.pasted || m === 'bold' || m === 'italic' || m === 'underline',
    );
    if (marks.length) span.marks = marks;
    if (ctx.color) span.color = ctx.color;
    if (ctx.link) span.link = ctx.link;
    if (mention) span.mention = mention;
    out.push(span);
    length += text.length;
    lastChar = text.slice(-1);
  };
  const walk = (node: Node, ctx: Context) => {
    if (options.limit !== undefined && length > options.limit) return;
    if (node.nodeType === Node.TEXT_NODE) {
      let text = (node as Text).data.replace(/\r\n?/g, '\n');
      if (options.pasted) text = text.replace(/\u00a0/g, ' ');
      if (options.pasted && !ctx.pre) {
        text = text.replace(/[ \t\n\f]+/g, ' ');
        // Spaces between blocks or at the start of a line show nothing in a browser.
        if (text === ' ' && (breakBefore || length === 0 || lastChar === '\n')) return;
      }
      if (text) push(text, ctx);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || SKIPPED.has(node.nodeName)) return;
    const el = node as Element;
    if (el.nodeName === 'BR') {
      if (el !== trailing) push('\n', ctx);
      return;
    }
    if (el.hasAttribute('data-mention')) {
      push(el.textContent ?? '', ctx, readMention(el) ?? undefined);
      return;
    }
    const block = BLOCKS.has(el.nodeName);
    if (block) breakBefore = true;
    const inner = enter(el, ctx);
    for (let child = el.firstChild; child; child = child.nextSibling) walk(child, inner);
    if (block) breakBefore = true;
  };
  walk(root, { marks: new Set(), pre: false });
  return normalizeRichText(out);
}

/** The text in the editor after the browser changed it. */
export function readRichText(root: HTMLElement): RichText {
  return read(root, { pasted: false });
}

/**
 * Pasted HTML as rich text: bold, italic and underline (from tags or inline styles), our own
 * colours and safe web links stay; headings, fonts, sizes, other colours, images and the rest go.
 */
export function readPastedHtml(html: string, limit: number): RichText {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return tidyLines(read(doc.body, { pasted: true, limit }));
}

/** Pasted plain text: line breaks and tabs kept, other control characters dropped. */
export function readPastedText(text: string): RichText {
  const clean = [...text.replace(/\r\n?/g, '\n')]
    .filter((c) => c === '\n' || c === '\t' || (c >= ' ' && c !== '\u007f'))
    .join('');
  return clean ? [{ text: clean }] : [];
}

// ------------------------------------------------------------------ the selection

interface Leaf {
  node: Node;
  length: number;
}

/** Text, <br> and mentions in order, each with the characters it stands for. */
function leaves(root: HTMLElement): Leaf[] {
  const out: Leaf[] = [];
  const trailing = lastLeaf(root);
  const walk = (node: Node) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE)
        out.push({ node: child, length: (child as Text).length });
      else if (child.nodeName === 'BR')
        out.push({ node: child, length: child === trailing ? 0 : 1 });
      else if (child.nodeType !== Node.ELEMENT_NODE) continue;
      else if ((child as Element).hasAttribute('data-mention'))
        out.push({ node: child, length: child.textContent?.length ?? 0 });
      else walk(child);
    }
  };
  walk(root);
  return out;
}

const precedes = (a: Node, b: Node) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && !a.contains(b);

/** The character offset of a point in the editor. */
export function offsetOf(root: HTMLElement, node: Node, offset: number): number {
  let total = 0;
  for (const leaf of leaves(root)) {
    if (leaf.node === node) {
      const text = node.nodeType === Node.TEXT_NODE;
      return total + (text ? Math.min(offset, leaf.length) : offset > 0 ? leaf.length : 0);
    }
    if (leaf.node.contains(node)) return total + (offset > 0 ? leaf.length : 0);
    const before =
      node.nodeType === Node.TEXT_NODE
        ? precedes(leaf.node, node)
        : offset < node.childNodes.length
          ? precedes(leaf.node, node.childNodes[offset] as Node)
          : node.contains(leaf.node) || precedes(leaf.node, node);
    if (!before) return total;
    total += leaf.length;
  }
  return total;
}

function beside(node: Node, after: boolean): { node: Node; offset: number } {
  const parent = node.parentNode as Node;
  const index = Array.prototype.indexOf.call(parent.childNodes, node) as number;
  return { node: parent, offset: index + (after ? 1 : 0) };
}

/** The point in the editor at a character offset. */
export function pointAt(root: HTMLElement, offset: number): { node: Node; offset: number } {
  let at = 0;
  const all = leaves(root);
  for (const [i, leaf] of all.entries()) {
    const end = at + leaf.length;
    if (leaf.node.nodeType === Node.TEXT_NODE) {
      const text = (leaf.node as Text).data;
      // After a final line break the caret belongs on the next line, so move on to what follows.
      const moveOn = offset === end && text.endsWith('\n') && i < all.length - 1;
      if (offset <= end && !moveOn) return { node: leaf.node, offset: offset - at };
    } else {
      if (offset <= at) return beside(leaf.node, false);
      if (offset < end) return beside(leaf.node, true);
    }
    at = end;
  }
  return { node: root, offset: root.childNodes.length };
}

/** The selection as character offsets, or null when it isn't inside the editor. */
export function readSelection(root: HTMLElement): TextRange | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const a = offsetOf(root, range.startContainer, range.startOffset);
  const b = offsetOf(root, range.endContainer, range.endOffset);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

export function writeSelection(root: HTMLElement, { start, end }: TextRange): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const a = pointAt(root, start);
  const b = pointAt(root, end);
  const range = root.ownerDocument.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}
