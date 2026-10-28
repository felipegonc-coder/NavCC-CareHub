// @carehub/extras/claude/markdown: Claude's Markdown answer as page blocks (Tiptap JSON), for the
// result box and for Replace or Insert below. Claude's output is untrusted text (docs/extras/
// claude.md): only blocks and marks the page editor has come out, text stays text (never HTML),
// pictures become their words, and only web, email and Care Hub page links are kept.

/** A mark on a run of text, as the page editor names it. */
export type ClaudeMark =
  { type: 'bold' | 'italic' | 'strike' | 'code' } | { type: 'link'; attrs: { href: string } };

export interface ClaudeText {
  type: 'text';
  text: string;
  marks?: ClaudeMark[];
}

export interface ClaudeLineBreak {
  type: 'hardBreak';
}

export type ClaudeInline = ClaudeText | ClaudeLineBreak;

/** A block of the page editor: paragraph, heading (1 to 3), lists, to-dos, quote, divider, code. */
export interface ClaudeBlock {
  type:
    | 'paragraph'
    | 'heading'
    | 'bulletList'
    | 'orderedList'
    | 'listItem'
    | 'taskList'
    | 'taskItem'
    | 'blockquote'
    | 'horizontalRule'
    | 'codeBlock';
  attrs?: Record<string, string | number | boolean>;
  content?: (ClaudeBlock | ClaudeInline)[];
}

/** A web address with a plain host name (and maybe a port): no password, nothing before the host. */
const WEB_LINK =
  /^https?:\/\/(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)*[a-z\d](?:[a-z\d-]*[a-z\d])?(?::\d{1,5})?(?:[/?#]\S*)?$/i;

/**
 * The link Claude may add, or null: http(s) addresses with a host name, `mailto:` addresses and
 * Care Hub pages (`/p/<id>`). Stricter than the editor's own link check, which still runs on
 * everything the page draws.
 */
export function claudeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^\/p\/[\w-]+(?:[?#]\S*)?$/.test(href)) return href;
  if (/^mailto:[^\s@/:]+@[^\s@/:]+$/i.test(href)) return href;
  return WEB_LINK.test(href) ? href : null;
}

/** How deep lists, quotes and marks may nest before the rest is read as plain text. */
const MAX_DEPTH = 12;

const PUNCTUATION = /^[!-/:-@[-`{-~]$/;
const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char);
const isWord = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);

function runLength(text: string, at: number, char: string): number {
  let end = at;
  while (text.charAt(end) === char) end += 1;
  return end - at;
}

function sameMarks(a: readonly ClaudeMark[] = [], b: readonly ClaudeMark[] = []): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function addText(out: ClaudeInline[], text: string, marks: readonly ClaudeMark[]): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.type === 'text' && sameMarks(last.marks, marks)) {
    last.text += text;
    return;
  }
  out.push(marks.length > 0 ? { type: 'text', text, marks: [...marks] } : { type: 'text', text });
}

/** A code span opened by the backticks at `start`, or null when they never close. */
function codeSpanAt(text: string, start: number): { code: string; end: number } | null {
  const size = runLength(text, start, '`');
  for (let at = text.indexOf('`', start + size); at !== -1;) {
    const run = runLength(text, at, '`');
    if (run === size) {
      let code = text.slice(start + size, at).replace(/\n/g, ' ');
      if (/^ .*\S.* $/.test(code)) code = code.slice(1, -1);
      return code ? { code, end: at + size } : null;
    }
    at = text.indexOf('`', at + run);
  }
  return null;
}

/** `[label](address)` starting at `start`, or null. */
function linkAt(text: string, start: number): { label: string; url: string; end: number } | null {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const char = text.charAt(i);
    if (char === '\\') i += 1;
    else if (char === '[') depth += 1;
    else if (char === ']' && --depth === 0) {
      if (text.charAt(i + 1) !== '(') return null;
      const close = text.indexOf(')', i + 2);
      if (close === -1) return null;
      const url =
        text
          .slice(i + 2, close)
          .trim()
          .split(/\s+/)[0] ?? '';
      return { label: text.slice(start + 1, i), url: url.replace(/^<|>$/g, ''), end: close + 1 };
    }
  }
  return null;
}

/** Where the emphasis of `size` × `char` opened at `start` closes, or -1. */
function closingAt(text: string, start: number, size: number, char: string): number {
  if (isSpace(text[start + size])) return -1;
  if (char === '_' && isWord(text[start - 1])) return -1;
  let at = start + size;
  while (at < text.length) {
    const here = text.charAt(at);
    if (here === '\\') {
      at += 2;
      continue;
    }
    if (here === '`') {
      const span = codeSpanAt(text, at);
      at = span ? span.end : at + runLength(text, at, '`');
      continue;
    }
    if (here !== char) {
      at += 1;
      continue;
    }
    const run = runLength(text, at, char);
    const fits =
      run === size && !isSpace(text[at - 1]) && !(char === '_' && isWord(text[at + run]));
    if (fits) return at;
    at += run;
  }
  return -1;
}

const EMPHASIS: Readonly<Record<string, readonly ClaudeMark[]>> = {
  '*': [{ type: 'italic' }],
  '**': [{ type: 'bold' }],
  '***': [{ type: 'bold' }, { type: 'italic' }],
  _: [{ type: 'italic' }],
  __: [{ type: 'bold' }],
  ___: [{ type: 'bold' }, { type: 'italic' }],
  '~~': [{ type: 'strike' }],
};

/** A paragraph's or heading's text with its marks; a line break stays a line break. */
function parseInline(
  text: string,
  marks: readonly ClaudeMark[],
  out: ClaudeInline[],
  depth = 0,
): void {
  if (depth > MAX_DEPTH) {
    addText(out, text, marks);
    return;
  }
  let i = 0;
  while (i < text.length) {
    const char = text.charAt(i);
    const next = text.charAt(i + 1);
    if (char === '\\' && (next === '\n' || PUNCTUATION.test(next))) {
      if (next === '\n') out.push({ type: 'hardBreak' });
      else addText(out, next, marks);
      i += 2;
      continue;
    }
    if (char === '\n') {
      out.push({ type: 'hardBreak' });
      i += 1;
      continue;
    }
    if (char === '`') {
      const span = codeSpanAt(text, i);
      if (span) {
        // Code takes no other marks in the editor.
        addText(out, span.code, [{ type: 'code' }]);
        i = span.end;
        continue;
      }
      const run = runLength(text, i, '`');
      addText(out, text.slice(i, i + run), marks);
      i += run;
      continue;
    }
    if (char === '!' && next === '[') {
      const image = linkAt(text, i + 1);
      if (image) {
        // No pictures from Claude, only their words.
        parseInline(image.label, marks, out, depth + 1);
        i = image.end;
        continue;
      }
    }
    if (char === '[') {
      const link = linkAt(text, i);
      if (link) {
        const href = claudeHref(link.url);
        const linked = marks.filter((mark) => mark.type !== 'link');
        parseInline(
          link.label,
          href ? [...linked, { type: 'link', attrs: { href } }] : marks,
          out,
          depth + 1,
        );
        i = link.end;
        continue;
      }
    }
    if (char === '<') {
      const end = text.indexOf('>', i + 1);
      const href = end === -1 ? null : claudeHref(text.slice(i + 1, end));
      if (href) {
        addText(out, href, [...marks, { type: 'link', attrs: { href } }]);
        i = end + 1;
        continue;
      }
    }
    if (char === '*' || char === '_' || char === '~') {
      const size = runLength(text, i, char);
      const delimiter = char.repeat(size);
      const added = EMPHASIS[delimiter];
      const end = added ? closingAt(text, i, size, char) : -1;
      if (added && end !== -1) {
        const fresh = added.filter((mark) => !marks.some((outer) => outer.type === mark.type));
        parseInline(text.slice(i + size, end), [...marks, ...fresh], out, depth + 1);
        i = end + size;
      } else {
        addText(out, delimiter, marks);
        i += size;
      }
      continue;
    }
    addText(out, char, marks);
    i += 1;
  }
}

function inline(text: string): ClaudeInline[] {
  const out: ClaudeInline[] = [];
  parseInline(text.trim(), [], out);
  const last = out[out.length - 1];
  if (last?.type === 'hardBreak') out.pop();
  return out;
}

function withContent(block: ClaudeBlock, content: ClaudeBlock['content']): ClaudeBlock {
  return content && content.length > 0 ? { ...block, content } : block;
}

const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const DIVIDER = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const QUOTE = /^ {0,3}>/;

type ListKind = 'bulletList' | 'orderedList' | 'taskList';

function listKind(marker: string, text: string): ListKind {
  if (/^\d/.test(marker)) return 'orderedList';
  return TASK.test(text) ? 'taskList' : 'bulletList';
}

const indentOf = (line: string) => /^ */.exec(line)?.[0].length ?? 0;

/** Blocks from lines of Markdown (tabs already spaces). */
function parseBlocks(lines: readonly string[], depth = 0): ClaudeBlock[] {
  if (depth > MAX_DEPTH) {
    const words = lines.map((line) => line.trim()).filter((line) => line !== '');
    return words.length > 0 ? [withContent({ type: 'paragraph' }, inline(words.join('\n')))] : [];
  }
  const blocks: ClaudeBlock[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(withContent({ type: 'paragraph' }, inline(paragraph.join('\n'))));
    }
    paragraph = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      endParagraph();
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line)?.[1];
    if (fence) {
      endParagraph();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(fence)) {
        code.push(lines[i] ?? '');
        i += 1;
      }
      i += 1;
      const text = code.join('\n');
      blocks.push(withContent({ type: 'codeBlock' }, text ? [{ type: 'text', text }] : []));
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      endParagraph();
      const level = Math.min(3, heading[1]?.length ?? 1);
      blocks.push(withContent({ type: 'heading', attrs: { level } }, inline(heading[2] ?? '')));
      i += 1;
      continue;
    }
    if (DIVIDER.test(line)) {
      endParagraph();
      blocks.push({ type: 'horizontalRule' });
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      endParagraph();
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) {
        quoted.push((lines[i] ?? '').replace(/^ {0,3}> ?/, ''));
        i += 1;
      }
      const inner = parseBlocks(quoted, depth + 1);
      blocks.push({
        type: 'blockquote',
        content: inner.length > 0 ? inner : [{ type: 'paragraph' }],
      });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    // A list can break into a paragraph only with a bullet or a 1.
    if (item && (paragraph.length === 0 || /^([-*+]|1[.)])$/.test(item[2] ?? ''))) {
      endParagraph();
      i = parseList(lines, i, blocks, depth);
      continue;
    }
    paragraph.push(line.trim());
    i += 1;
  }
  endParagraph();
  return blocks;
}

/** The list starting at line `start`, added to `blocks`; returns the line after it. */
function parseList(
  lines: readonly string[],
  start: number,
  blocks: ClaudeBlock[],
  depth: number,
): number {
  const first = LIST_ITEM.exec(lines[start] ?? '');
  const base = first?.[1]?.length ?? 0;
  const kind = listKind(first?.[2] ?? '-', first?.[4] ?? '');
  const items: ClaudeBlock[] = [];
  let i = start;
  while (i < lines.length) {
    const match = LIST_ITEM.exec(lines[i] ?? '');
    if (!match || (match[1]?.length ?? 0) !== base) break;
    if (listKind(match[2] ?? '-', match[4] ?? '') !== kind) break;
    const gap = match[3]?.length ?? 1;
    const contentIndent = base + (match[2]?.length ?? 1) + (gap >= 1 && gap <= 4 ? gap : 1);
    const body: string[] = [match[4] ?? ''];
    i += 1;
    // The item's other lines are indented under it, maybe after a blank line.
    while (i < lines.length) {
      const next = lines[i] ?? '';
      if (next.trim() === '') {
        const after = lines[i + 1] ?? '';
        if (after.trim() === '' || indentOf(after) <= base) break;
        body.push('');
        i += 1;
        continue;
      }
      if (indentOf(next) <= base) break;
      body.push(next.slice(Math.min(indentOf(next), contentIndent)));
      i += 1;
    }
    let checked = false;
    if (kind === 'taskList') {
      const task = TASK.exec(body[0] ?? '');
      checked = task?.[1] === 'x' || task?.[1] === 'X';
      body[0] = task?.[2] ?? '';
    }
    const inner = parseBlocks(body, depth + 1);
    if (inner[0]?.type !== 'paragraph') inner.unshift({ type: 'paragraph' });
    items.push(
      kind === 'taskList'
        ? { type: 'taskItem', attrs: { checked }, content: inner }
        : { type: 'listItem', content: inner },
    );
  }
  const startNumber = kind === 'orderedList' ? Number.parseInt(first?.[2] ?? '1', 10) : 1;
  blocks.push(
    startNumber !== 1
      ? { type: kind, attrs: { start: startNumber }, content: items }
      : { type: kind, content: items },
  );
  return i;
}

/** Claude's Markdown answer as page blocks; none for an empty answer. */
export function markdownToBlocks(markdown: string): ClaudeBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  return parseBlocks(lines);
}

const TEXT_BLOCKS: ReadonlySet<ClaudeBlock['type']> = new Set([
  'paragraph',
  'heading',
  'codeBlock',
]);

const isBlock = (node: ClaudeBlock | ClaudeInline): node is ClaudeBlock =>
  node.type !== 'text' && node.type !== 'hardBreak';

function inlineText(nodes: readonly (ClaudeBlock | ClaudeInline)[]): string {
  return nodes
    .map((node) => (node.type === 'text' ? node.text : node.type === 'hardBreak' ? '\n' : ''))
    .join('');
}

/** The blocks' words, one text block per line: what a screen reader hears of the answer. */
export function blocksText(blocks: readonly ClaudeBlock[]): string {
  return blocks
    .map((block) =>
      TEXT_BLOCKS.has(block.type)
        ? inlineText(block.content ?? [])
        : blocksText((block.content ?? []).filter(isBlock)),
    )
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * The inline content when the answer is one plain paragraph, so Replace keeps the selection's
 * block (its type, its place in a list) and swaps only its words; null otherwise.
 */
export function singleParagraph(blocks: readonly ClaudeBlock[]): ClaudeInline[] | null {
  const [only] = blocks;
  if (blocks.length !== 1 || only?.type !== 'paragraph') return null;
  return (only.content ?? []) as ClaudeInline[];
}
