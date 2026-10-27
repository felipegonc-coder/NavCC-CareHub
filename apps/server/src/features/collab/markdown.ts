import { createPageSchema } from '@carehub/editor/schema';
import MarkdownIt from 'markdown-it';
import type { SchemaInfo } from './check';
import { cleanContent } from './clean';
import { MAX_DEPTH, toText, type PageMark, type PageNode } from './ydoc';

/**
 * Page content as Markdown, for export, imports and templates (decision 0007, section 4.2).
 * Blocks without a Markdown form are kept as `<!-- carehub:block {json} -->` comments (inline
 * nodes as `<!-- carehub:inline {json} -->`), so an export imports back without losing them.
 */

/** Marks in the order they open, outermost first. Others are left out of Markdown. */
const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'underline'];
const DELIMITERS: Record<string, string> = { bold: '**', italic: '*', strike: '~~' };
/** HTML for marks, where Markdown has no syntax or its delimiters would read back differently. */
const HTML_TAGS: Record<string, string> = {
  bold: 'strong',
  italic: 'em',
  strike: 's',
  underline: 'u',
  code: 'code',
};
const HTML_MARKS = new Map<string, string>([
  ...Object.entries(HTML_TAGS).map(([mark, tag]): [string, string] => [tag, mark]),
  ['b', 'bold'],
  ['i', 'italic'],
  ['del', 'strike'],
]);
const PLACEHOLDER = /^<!--\s*carehub:(block|inline)\s+(\{[\s\S]*\})\s*-->$/;
/**
 * Lists and quotes nested deeper than this go out as one comment each: every level indents
 * all the lines inside it, so deep nesting would multiply the size of the export.
 */
const MARKDOWN_DEPTH = 8;
/**
 * A code block in lists and quotes takes their indent on every line. When that adds more than
 * this and more than the code itself, the block goes out as a comment instead.
 */
const CODE_GROWTH = 4_096;
const CONTAINERS = new Set(['blockquote', 'bulletList', 'orderedList', 'taskList']);
/** CommonMark list numbers have at most nine digits. */
const MAX_LIST_NUMBER = 999_999_999;

// Raw HTML is read only to find placeholders and <u>/<br>; anything else stays visible as text.
// Tables read as text until pages have a table block.
const parser = MarkdownIt('default', { html: true, linkify: false, typographer: false }).disable(
  'table',
);
type Token = ReturnType<typeof parser.parse>[number];

type PageSchema = ReturnType<typeof createPageSchema>;
let schema: PageSchema | undefined;

// --- Export ---------------------------------------------------------------------------------

export function toMarkdown(nodes: readonly PageNode[], info: SchemaInfo): string {
  const text = blocksToMarkdown(nodes, info, { depth: 0, indent: 0 });
  return text ? `${text}\n` : '';
}

/** Where blocks go: how many lists and quotes are around them, and how far that indents them. */
interface Level {
  depth: number;
  indent: number;
}

function blocksToMarkdown(
  nodes: readonly PageNode[],
  info: SchemaInfo,
  level: Level,
  inItem = false,
): string {
  const blocks: string[] = [];
  let previous = '';
  let alt = false;
  for (const node of nodes) {
    // Lists of one kind next to each other would read as one list, so they take turns at markers.
    const kind = LIST_KINDS[node.type] ?? '';
    alt = kind !== '' && kind === previous ? !alt : false;
    const text = blockToMarkdown(node, info, level, alt);
    if (text === '' && !(inItem && blocks.length === 0)) continue;
    blocks.push(text);
    previous = kind;
  }
  // An item's empty first paragraph keeps its line, so the blocks after it stay in the item.
  if (blocks[0] === '' && blocks.length > 1) return `\n${blocks.slice(1).join('\n\n')}`;
  return blocks.filter((text) => text !== '').join('\n\n');
}

const LIST_KINDS: Record<string, string> = {
  bulletList: 'bullet',
  taskList: 'bullet',
  orderedList: 'ordered',
};

function blockToMarkdown(node: PageNode, info: SchemaInfo, level: Level, alt: boolean): string {
  if (level.depth >= MARKDOWN_DEPTH && CONTAINERS.has(node.type)) return placeholder('block', node);
  const content = node.content ?? [];
  const inside = (prefix: string): Level => ({
    depth: level.depth + 1,
    indent: level.indent + prefix.length,
  });
  const items = (marker: (item: PageNode, index: number) => [string, string]) =>
    content
      .map((item, index) => {
        const [first, rest] = marker(item, index);
        const body = blocksToMarkdown(item.content ?? [], info, inside(rest), true);
        return prefixLines(body, first, rest);
      })
      .join('\n');
  switch (node.type) {
    case 'paragraph':
      return inlineToMarkdown(content, info, true);
    case 'heading': {
      const hashes = '#'.repeat(Math.min(3, Math.max(1, Number(node.attrs?.level) || 1)));
      return `${hashes} ${inlineToMarkdown(content, info)}`;
    }
    case 'blockquote':
      return prefixLines(blocksToMarkdown(content, info, inside('> ')), '> ', '> ');
    case 'bulletList':
      return items(() => [alt ? '* ' : '- ', '  ']);
    case 'orderedList': {
      const start = listStart(node.attrs?.start, content.length);
      return items((_, index) => {
        const marker = `${start + index}${alt ? ')' : '.'} `;
        return [marker, ' '.repeat(marker.length)];
      });
    }
    case 'taskList':
      return items((item) => [`${alt ? '*' : '-'} [${item.attrs?.checked ? 'x' : ' '}] `, '  ']);
    case 'codeBlock':
      return codeBlockToMarkdown(node, level.indent);
    case 'horizontalRule':
      return '---';
    default:
      return placeholder('block', node);
  }
}

/** A list's first number: a whole number from 0 that keeps the last one within nine digits. */
function listStart(value: unknown, items: number): number {
  const start = Math.trunc(Number(value ?? 1));
  if (!Number.isFinite(start)) return 1;
  return Math.max(0, Math.min(start, MAX_LIST_NUMBER - Math.max(0, items - 1)));
}

function codeBlockToMarkdown(node: PageNode, indent: number): string {
  const code = (node.content ?? []).map((child) => child.text ?? '').join('');
  let lines = 2; // and the fences
  for (let at = code.indexOf('\n'); at >= 0; at = code.indexOf('\n', at + 1)) lines += 1;
  if (indent * lines > Math.max(CODE_GROWTH, code.length)) return placeholder('block', node);
  const language = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
  const fence = '`'.repeat(Math.max(2, longestBackticks(code)) + 1);
  return `${fence}${language.replace(/[`\s]/g, '')}\n${code}\n${fence}`;
}

function longestBackticks(text: string): number {
  let longest = 0;
  for (const [run] of text.matchAll(/`+/g)) longest = Math.max(longest, run.length);
  return longest;
}

/**
 * Inline Markdown, as a whole paragraph if `paragraph`. If `**` and the like would read back
 * differently (they depend on the characters around them), HTML tags instead.
 */
function inlineToMarkdown(nodes: readonly PageNode[], info: SchemaInfo, paragraph = false): string {
  const runs = mergeRuns(nodes);
  const write = (html: boolean) => {
    const text = serializeInline(runs, info, html);
    return paragraph ? escapeLineStarts(text.replace(/^\s+/, '')) : text;
  };
  const text = write(false);
  if (runs.every((node) => node.type === 'text' && !node.marks?.length)) return text;
  return signature(readBack(text, info, paragraph)) === signature(runs) ? text : write(true);
}

function readBack(text: string, info: SchemaInfo, paragraph: boolean): PageNode[] {
  if (!paragraph) return inlineNodes(parser.parseInline(text, {})[0]?.children ?? [], info);
  const blocks = fromMarkdown(text, info);
  return blocks.length === 1 && blocks[0]?.type === 'paragraph' ? (blocks[0].content ?? []) : [];
}

function serializeInline(nodes: readonly PageNode[], info: SchemaInfo, html: boolean): string {
  let out = '';
  const open: PageMark[] = [];
  const closeTo = (keep: number) => {
    if (open.length <= keep) return;
    // Emphasis can't end after a space, so trailing spaces move past the closing delimiters.
    // Found from the end: a /[ \t]*$/ search takes quadratic time on a long run of spaces.
    let end = out.length;
    while (end > 0 && (out[end - 1] === ' ' || out[end - 1] === '\t')) end -= 1;
    const trailing = out.slice(end);
    out = out.slice(0, end);
    while (open.length > keep) {
      const mark = open.pop();
      if (mark) out += closer(mark, html);
    }
    out += trailing;
  };
  for (const node of nodes) {
    if (node.type !== 'text') {
      closeTo(0);
      // <br> rather than a line break, so no line but the first can start a block.
      out += node.type === 'hardBreak' ? '<br>' : placeholder('inline', node);
      continue;
    }
    let text = (node.text ?? '').replace(/[\r\n]/g, ' ');
    const marks = markdownMarks(node.marks ?? [], info, html);
    let keep = 0;
    while (keep < open.length && keep < marks.length && sameMark(open[keep], marks[keep])) {
      keep += 1;
    }
    closeTo(keep);
    if (marks.length > keep && text.trim() !== '') {
      const leading = /^\s*/.exec(text)?.[0] ?? '';
      out += leading;
      text = text.slice(leading.length);
      for (const mark of marks.slice(keep)) {
        out += opener(mark, html);
        open.push(mark);
      }
    }
    const isCode = !html && (node.marks ?? []).some((mark) => mark.type === 'code');
    out += isCode ? codeSpan(text) : escapeText(text);
  }
  closeTo(0);
  return out;
}

/** Adjacent text with the same marks as one run, so code spans and delimiters don't touch. */
function mergeRuns(nodes: readonly PageNode[]): PageNode[] {
  const key = (node: PageNode) =>
    JSON.stringify([...(node.marks ?? [])].sort((a, b) => a.type.localeCompare(b.type)));
  const runs: PageNode[] = [];
  for (const node of nodes) {
    const last = runs[runs.length - 1];
    if (node.type === 'text' && last?.type === 'text' && key(last) === key(node)) {
      runs[runs.length - 1] = { ...last, text: `${last.text ?? ''}${node.text ?? ''}` };
    } else runs.push(node);
  }
  return runs;
}

/** What a reader sees: each visible character with its Markdown marks, and inline nodes. */
function signature(nodes: readonly PageNode[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (node.type !== 'text') parts.push(`<${node.type}>`);
    const marks = (node.marks ?? [])
      .map((mark) => mark.type)
      .filter((type) => type === 'code' || MARK_ORDER.includes(type))
      .sort()
      .join();
    for (const char of node.type === 'text' ? (node.text ?? '') : '') {
      if (char.trim()) parts.push(`${char} ${marks}`);
    }
  }
  return parts.join('\n');
}

function markdownMarks(marks: readonly PageMark[], info: SchemaInfo, html: boolean): PageMark[] {
  // In HTML, code is a tag like the others (innermost); in Markdown, a code span.
  const order = html ? [...MARK_ORDER, 'code'] : MARK_ORDER;
  return marks
    .filter((mark) => order.includes(mark.type))
    .filter((mark) => mark.type !== 'link' || info.isSafeUrl(String(mark.attrs?.href ?? '')))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
}

function sameMark(a: PageMark | undefined, b: PageMark | undefined): boolean {
  return a?.type === b?.type && a?.attrs?.href === b?.attrs?.href;
}

function opener(mark: PageMark, html: boolean): string {
  if (mark.type === 'link') return '[';
  const delimiter = html ? undefined : DELIMITERS[mark.type];
  return delimiter ?? `<${HTML_TAGS[mark.type]}>`;
}

function closer(mark: PageMark, html: boolean): string {
  if (mark.type !== 'link') {
    const delimiter = html ? undefined : DELIMITERS[mark.type];
    return delimiter ?? `</${HTML_TAGS[mark.type]}>`;
  }
  const href = String(mark.attrs?.href ?? '').replace(/[\s<>]/g, encodeURIComponent);
  const title = typeof mark.attrs?.title === 'string' ? mark.attrs.title.replace(/\s/g, ' ') : '';
  return `](<${href}>${title ? ` "${title.replace(/["\\]/g, '\\$&')}"` : ''})`;
}

function codeSpan(text: string): string {
  const fence = '`'.repeat(longestBackticks(text) + 1);
  // Markdown drops one space from each end of a code span that has both, and needs one by a `.
  const spaced = text.trim() !== '' && text.startsWith(' ') && text.endsWith(' ');
  const pad = spaced || text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function escapeText(text: string): string {
  return text.replace(/[\\`*_[\]<>&~|#!]/g, '\\$&');
}

/** Keeps a paragraph from reading as a list or rule (`#`, `>` and the like are escaped). */
function escapeLineStarts(text: string): string {
  return text.replace(/^(\d+)([.)])(\s|$)/, '$1\\$2$3').replace(/^[-+=]/, '\\$&');
}

function prefixLines(text: string, first: string, rest: string): string {
  return text
    .split('\n')
    .map((line, index) => {
      if (index === 0) return `${first}${line}`.trimEnd() || first.trimEnd();
      return line === '' ? rest.trimEnd() : `${rest}${line}`;
    })
    .join('\n');
}

function placeholder(kind: 'block' | 'inline', node: PageNode): string {
  // Unicode escapes keep the JSON valid and the comment closed, whatever the text holds.
  const json = JSON.stringify(node)
    .replace(/[<>]/g, (char) => (char === '<' ? '\\u003c' : '\\u003e'))
    .replace(/--/g, '-\\u002d');
  return `<!-- carehub:${kind} ${json} -->`;
}

// --- Import ---------------------------------------------------------------------------------

/** Page blocks from Markdown. Unsafe links become plain text; raw HTML is kept as text. */
export function fromMarkdown(markdown: string, info: SchemaInfo): PageNode[] {
  const root: PageNode = { type: 'doc', content: [] };
  const stack: PageNode[] = [root];
  const current = () => stack[stack.length - 1] ?? root;
  const append = (node: PageNode) => {
    const parent = current();
    (parent.content ??= []).push(node);
    return node;
  };
  const open = (node: PageNode) => stack.push(append(node));
  // Items whose source starts with `[ ]` or `[x]` (not `\[ \]`), and whether they're checked.
  const tasks = new Map<PageNode, boolean>();
  for (const token of parser.parse(markdown, {})) {
    switch (token.type) {
      case 'paragraph_open':
        open({ type: 'paragraph' });
        break;
      case 'heading_open':
        open({ type: 'heading', attrs: { level: Math.min(3, Number(token.tag.slice(1)) || 1) } });
        break;
      case 'blockquote_open':
        open({ type: 'blockquote' });
        break;
      case 'bullet_list_open':
        open({ type: 'bulletList' });
        break;
      case 'ordered_list_open': {
        const start = listStart(token.attrGet('start'), 1);
        open(start === 1 ? { type: 'orderedList' } : { type: 'orderedList', attrs: { start } });
        break;
      }
      case 'list_item_open':
        open({ type: 'listItem' });
        break;
      case 'inline': {
        const item = stack[stack.length - 2];
        const box = item?.content?.length === 1 ? TASK_BOX.exec(token.content) : null;
        if (box && item?.type === 'listItem' && current().type === 'paragraph') {
          tasks.set(item, box[1] !== ' ');
        }
        const content = inlineNodes(token.children ?? [], info);
        if (content.length > 0) current().content = [...(current().content ?? []), ...content];
        break;
      }
      case 'fence':
      case 'code_block': {
        const code = token.content.replace(/\n$/, '');
        const language = token.info.trim().split(/\s+/)[0] ?? '';
        append({
          type: 'codeBlock',
          ...(language ? { attrs: { language } } : {}),
          ...(code ? { content: [{ type: 'text', text: code }] } : {}),
        });
        break;
      }
      case 'hr':
        append({ type: 'horizontalRule' });
        break;
      case 'html_block': {
        const node = readPlaceholder(token.content, 'block', info, stack.length - 1);
        append(node ?? htmlParagraph(token.content, info));
        break;
      }
      default:
        if (token.nesting === -1) stack.pop();
    }
  }
  return tidy(root.content ?? [], info, tasks, 0);
}

function inlineNodes(tokens: readonly Token[], info: SchemaInfo): PageNode[] {
  const nodes: PageNode[] = [];
  const marks: PageMark[] = [];
  const add = (text: string, extra?: PageMark) => {
    if (!text) return;
    const all = (extra ? [...marks, extra] : marks).filter(
      (mark) => info.marks.has(mark.type) && (mark.type !== 'link' || mark.attrs),
    );
    const last = nodes[nodes.length - 1];
    if (last?.type === 'text' && sameMarks(last.marks ?? [], all)) {
      last.text = `${last.text ?? ''}${text}`;
      return;
    }
    nodes.push(all.length > 0 ? { type: 'text', text, marks: all } : { type: 'text', text });
  };
  const close = (type: string) => {
    const index = marks.map((mark) => mark.type).lastIndexOf(type);
    if (index >= 0) marks.splice(index, 1);
    return index >= 0;
  };
  const breakLine = () => {
    if (info.nodes.has('hardBreak')) nodes.push({ type: 'hardBreak' });
    else add(' ');
  };
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        add(token.content);
        break;
      case 'softbreak':
        add(' ');
        break;
      case 'hardbreak':
        breakLine();
        break;
      case 'code_inline':
        add(token.content, { type: 'code' });
        break;
      case 'link_open': {
        const href = String(token.attrGet('href') ?? '');
        const title = token.attrGet('title');
        // An unsafe address keeps its text but loses the link: a link mark without attributes.
        const attrs = title ? { href, title: String(title) } : { href };
        marks.push(info.isSafeUrl(href) ? { type: 'link', attrs } : { type: 'link' });
        break;
      }
      case 'link_close':
        close('link');
        break;
      case 'html_inline': {
        const html = token.content;
        const tag = /^<(\/?)([a-z]+)\s*>$/i.exec(html);
        const type = HTML_MARKS.get(tag?.[2]?.toLowerCase() ?? '');
        if (type && tag?.[1]) {
          if (!close(type)) add(html);
        } else if (type) marks.push({ type });
        else if (/^<br\s*\/?>$/i.test(html)) breakLine();
        else {
          const node = readPlaceholder(html, 'inline', info, 0);
          if (node) nodes.push(node);
          else add(html);
        }
        break;
      }
      default: {
        const style = /^(strong|em|s)_(open|close)$/.exec(token.type);
        const type = style ? INLINE_MARKS[style[1] ?? ''] : undefined;
        if (type && style?.[2] === 'open') marks.push({ type });
        else if (type) close(type);
        else add(token.content); // images and anything else: their text only
      }
    }
  }
  return nodes;
}

const INLINE_MARKS: Record<string, string> = { strong: 'bold', em: 'italic', s: 'strike' };

function sameMarks(a: readonly PageMark[], b: readonly PageMark[]): boolean {
  return (
    a.length === b.length &&
    a.every((mark, index) => JSON.stringify(mark) === JSON.stringify(b[index]))
  );
}

/** Raw HTML markdown-it read as a block: a paragraph, its tags as text (placeholders kept). */
function htmlParagraph(html: string, info: SchemaInfo): PageNode {
  const content = inlineNodes(parser.parseInline(html.trim(), {})[0]?.children ?? [], info);
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
}

function textParagraph(text: string): PageNode {
  const trimmed = text.trim();
  return trimmed
    ? { type: 'paragraph', content: [{ type: 'text', text: trimmed }] }
    : { type: 'paragraph' };
}

/** Task lists, and the shapes the editor needs: items and quotes start with a paragraph. */
function tidy(
  nodes: PageNode[],
  info: SchemaInfo,
  tasks: ReadonlyMap<PageNode, boolean>,
  depth: number,
): PageNode[] {
  for (const node of nodes) {
    if (!node.content || depth > MAX_DEPTH) continue;
    node.content = tidy(node.content, info, tasks, depth + 1);
    const first = node.content[0];
    if (node.type === 'bulletList' && info.nodes.has('taskList') && first && tasks.has(first)) {
      node.type = 'taskList';
      node.content = node.content.map((item) => {
        if (tasks.has(item)) stripTaskBox(item);
        const checked = tasks.get(item) === true;
        return { type: 'taskItem', attrs: { checked }, content: item.content ?? [] };
      });
    }
  }
  for (const node of nodes) {
    const wrapsBlocks = ['listItem', 'taskItem', 'blockquote'];
    if (wrapsBlocks.includes(node.type) && node.content?.[0]?.type !== 'paragraph') {
      (node.content ??= []).unshift({ type: 'paragraph' });
    }
  }
  return nodes;
}

const TASK_BOX = /^\[([ xX])\](?:\s|$)/;

function stripTaskBox(item: PageNode): void {
  const paragraph = item.content?.[0];
  const first = paragraph?.content?.[0];
  if (!paragraph || first?.type !== 'text') return;
  first.text = (first.text ?? '').replace(TASK_BOX, '');
  if (!first.text) paragraph.content?.shift();
  if (paragraph.content?.length === 0) delete paragraph.content;
}

/** The node in a `carehub:` comment, if the comment is one and its node is safe. */
function readPlaceholder(
  html: string,
  kind: 'block' | 'inline',
  info: SchemaInfo,
  depth: number,
): PageNode | null {
  const match = PLACEHOLDER.exec(html.trim());
  if (!match || match[1] !== kind || !match[2]) return null;
  let node: PageNode | null;
  try {
    node = cleanContent(JSON.parse(match[2]), info, depth);
  } catch {
    return null;
  }
  // Text is never kept in a comment, and only inline nodes go between words.
  if (!node || node.type === 'text') return null;
  return kind === 'block' || info.inline.has(node.type) ? node : null;
}

/**
 * Content the editor accepts as is: checked against the page schema, with default attributes
 * filled in. A top-level block that doesn't fit becomes a paragraph of its text.
 */
export function fitToSchema(nodes: readonly PageNode[]): PageNode[] {
  if (nodes.length === 0) return [];
  const pageSchema = (schema ??= createPageSchema());
  const check = (content: readonly PageNode[]): PageNode[] | null => {
    try {
      const doc = pageSchema.nodeFromJSON({ type: 'doc', content });
      doc.check();
      return (doc.toJSON() as PageNode).content ?? [];
    } catch {
      return null;
    }
  };
  const whole = check(nodes);
  if (whole) return whole;
  const fitted = nodes.flatMap(
    (node) => check([node]) ?? [textParagraph(toText([node]).replace(/\n/g, ' '))],
  );
  return check(fitted) ?? [];
}
