// A page as Markdown (Import and export spec, section 3.3): the title as a heading, then its
// properties as "Name: value" lines, then its blocks. Toggles become bullets with their content
// indented, callouts quotes starting with the icon, columns and synced blocks their content one
// after another, equations TeX between `$$`, and links to exported pages relative links.
import {
  attrNumber,
  attrText,
  fileIdOf,
  isInline,
  pageIdOf,
  plainText,
  roleOf,
  type ContentMark,
  type ContentNode,
} from './content';
import {
  altOf,
  iconOf,
  languageOf,
  markHref,
  texOf,
  type ExportLinks,
  type ExportPage,
} from './render';

/** Backslashes the characters Markdown would read as formatting. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>~|$]/g, '\\$&');
}

/** Spaces, control characters, `(`, `)`, `<`, `>` and `\`: they'd end a link's address early. */
const LINK_UNSAFE = /[^\x21-\x7e\u0080-\uffff]|[()<>\\]/g;

/**
 * A link's address as written between `(` and `)`, with the characters that could end the link
 * or start another one percent-encoded. `%` escapes already in it stay as they are.
 */
export function markdownHref(href: string): string {
  return href.replace(
    LINK_UNSAFE,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
}

/** Keeps a line of text from starting a heading, quote, list, rule or code block. */
function guardLineStart(text: string): string {
  const line = text.trimStart();
  if (/^[#>+=-]/.test(line)) return `\\${line}`;
  return line.replace(/^(\d+)([.)])/, '$1\\$2');
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = /^[\s`]|[\s`]$/.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

interface Delimiter {
  key: string;
  open: string;
  close: string;
}

const EMPHASIS: Record<string, Delimiter> = {
  bold: { key: 'bold', open: '**', close: '**' },
  strong: { key: 'bold', open: '**', close: '**' },
  italic: { key: 'italic', open: '*', close: '*' },
  em: { key: 'italic', open: '*', close: '*' },
  strike: { key: 'strike', open: '~~', close: '~~' },
  strikethrough: { key: 'strike', open: '~~', close: '~~' },
};
const ORDER = ['link', 'bold', 'italic', 'strike'];

/** A text node's Markdown delimiters, outermost first (underline and colours have none). */
function delimiters(marks: readonly ContentMark[], links: ExportLinks): Delimiter[] {
  const found: Delimiter[] = [];
  for (const mark of marks) {
    if (mark.type === 'link') {
      const href = markHref(mark, links);
      if (href !== null) {
        found.push({ key: `link ${href}`, open: '[', close: `](${markdownHref(href)})` });
      }
      continue;
    }
    const emphasis = EMPHASIS[mark.type];
    if (emphasis && !found.some((open) => open.key === emphasis.key)) found.push(emphasis);
  }
  const rank = (delimiter: Delimiter) => ORDER.indexOf(delimiter.key.split(' ')[0] ?? '');
  return found.sort((a, b) => rank(a) - rank(b));
}

function inlineNode(node: ContentNode, links: ExportLinks): string {
  switch (roleOf(node)) {
    case 'break':
      return '\\\n';
    case 'mathInline':
      return `$${texOf(node)}$`;
    case 'mention': {
      const pageId = pageIdOf(node);
      if (pageId !== undefined) {
        // Never the mention's saved label: it could name a page they can't open.
        const page = links.page(pageId);
        return page ? `[${escapeMarkdown(page.title)}](${markdownHref(page.href)})` : 'No access';
      }
      const label = attrText(node, 'label', 'name', 'date') ?? '';
      const person =
        ['userMention', 'personMention'].includes(node.type) || node.attrs?.kind === 'user';
      return escapeMarkdown(person && !label.startsWith('@') ? `@${label}` : label);
    }
    default:
      return escapeMarkdown(plainText(node));
  }
}

/** A line of text with its marks, opening and closing delimiters only where they change. */
export function inlineMarkdown(nodes: readonly ContentNode[], links: ExportLinks): string {
  let out = '';
  const open: Delimiter[] = [];
  const closeTo = (depth: number) => {
    if (open.length <= depth) return;
    // Delimiters must touch the text: spaces move outside them.
    const trailing = /\s*$/.exec(out)?.[0] ?? '';
    out = out.slice(0, out.length - trailing.length);
    while (open.length > depth) out += open.pop()?.close ?? '';
    out += trailing;
  };
  for (const node of nodes) {
    if (roleOf(node) !== 'text') {
      closeTo(0);
      out += inlineNode(node, links);
      continue;
    }
    const text = node.text ?? '';
    const marks = node.marks ?? [];
    const wanted = delimiters(marks, links);
    let same = 0;
    while (same < open.length && same < wanted.length && open[same]?.key === wanted[same]?.key) {
      same += 1;
    }
    closeTo(same);
    const lead = /^\s*/.exec(text)?.[0] ?? '';
    const body = text.slice(lead.length);
    out += lead;
    if (body === '') continue;
    for (const delimiter of wanted.slice(same)) {
      open.push(delimiter);
      out += delimiter.open;
    }
    out += marks.some((mark) => mark.type === 'code') ? codeSpan(body) : escapeMarkdown(body);
  }
  closeTo(0);
  return out;
}

/** Indents every line but blank ones. */
function indent(lines: readonly string[], by: string): string[] {
  return lines.map((line) => (line === '' ? '' : `${by}${line}`));
}

/** `marker` on the first line and the rest indented under it, as in a list item. */
function hang(marker: string, lines: readonly string[]): string[] {
  const [first = '', ...rest] = lines;
  return [`${marker} ${first}`.trimEnd(), ...indent(rest, ' '.repeat(marker.length + 1))];
}

function quote(lines: readonly string[]): string[] {
  return lines.map((line) => (line === '' ? '>' : `> ${line}`));
}

function paragraph(nodes: readonly ContentNode[], links: ExportLinks): string[] {
  const text = inlineMarkdown(nodes, links);
  if (text.trim() === '') return [];
  return text.split('\n').map(guardLineStart);
}

function list(node: ContentNode, links: ExportLinks): string[] {
  const role = roleOf(node);
  const start = attrNumber(node, 'start') ?? 1;
  const items = (node.content ?? []).filter((item) => roleOf(item) === 'listItem');
  return items.flatMap((item, index) => {
    const body = blockLines(item.content ?? [], links);
    let marker = role === 'orderedList' ? `${start + index}.` : '-';
    if (role === 'taskList' || item.type === 'taskItem') {
      marker = item.attrs?.checked === true ? '- [x]' : '- [ ]';
    }
    return hang(marker, body.length > 0 ? body : ['']);
  });
}

function table(node: ContentNode, links: ExportLinks): string[] {
  const rows = (node.content ?? [])
    .filter((row) => roleOf(row) === 'row')
    .map((row) =>
      (row.content ?? []).map((cell) =>
        blockLines(cell.content ?? [], links)
          .filter((line) => line !== '')
          .join(' ')
          .replace(/\\\n/g, ' '),
      ),
    );
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (width === 0) return [];
  const line = (cells: readonly string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  const [header = [], ...body] = rows;
  return [line(header), line(Array.from({ length: width }, () => '---')), ...body.map(line)];
}

function fenced(code: string, language: string): string[] {
  const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return [`${fence}${language}`, ...code.split('\n'), fence];
}

function toggle(node: ContentNode, links: ExportLinks): string[] {
  const [first, ...rest] = node.content ?? [];
  if (!first) return [];
  const summary =
    roleOf(first) === 'summary' || first.content?.every(isInline)
      ? inlineMarkdown(first.content ?? [], links).replace(/\\\n/g, ' ')
      : null;
  if (summary === null) return hang('-', blockLines([first, ...rest], links));
  const body = blockLines(rest, links);
  return hang('-', [summary, ...(body.length > 0 ? ['', ...body] : [])]);
}

function linkLine(title: string, href: string | null | undefined): string[] {
  return href ? [`[${escapeMarkdown(title)}](${markdownHref(href)})`] : [];
}

function block(node: ContentNode, links: ExportLinks): string[] {
  const children = node.content ?? [];
  switch (roleOf(node)) {
    case 'paragraph':
      return paragraph(children, links);
    case 'heading': {
      const level = Math.min(6, Math.max(1, attrNumber(node, 'level') ?? 1));
      const text = inlineMarkdown(children, links).replace(/\\\n/g, ' ').trim();
      return text === '' ? [] : [`${'#'.repeat(level)} ${text}`];
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return list(node, links);
    case 'quote':
      return quote(blockLines(children, links));
    case 'callout': {
      const lines = blockLines(children, links);
      const [first = '', ...rest] = lines;
      return quote([`${iconOf(node, '💡')} ${first}`.trimEnd(), ...rest]);
    }
    case 'code':
      return fenced(plainText(node), languageOf(node));
    case 'rule':
      return ['---'];
    case 'toggle':
      return toggle(node, links);
    case 'table':
      return table(node, links);
    case 'math':
      return ['$$', ...texOf(node).split('\n'), '$$'];
    case 'image': {
      const id = fileIdOf(node);
      const file = id === undefined ? null : links.file(id);
      const src = attrText(node, 'src', 'url');
      const href = file?.href ?? (id === undefined && src ? links.href(src) : null);
      if (!href) return ['*Picture not included*'];
      const caption = attrText(node, 'caption');
      const alt = escapeMarkdown(altOf(node, file?.name ?? 'Picture'));
      const picture = `![${alt}](${markdownHref(href)})`;
      return caption ? [picture, '', `*${escapeMarkdown(caption)}*`] : [picture];
    }
    case 'file': {
      const id = fileIdOf(node);
      const file = id === undefined ? null : links.file(id);
      const src = attrText(node, 'src', 'url');
      const name = attrText(node, 'name', 'fileName', 'title') ?? file?.name ?? src ?? 'File';
      return linkLine(name, file?.href ?? (id === undefined && src ? links.href(src) : null));
    }
    case 'embed': {
      const url = attrText(node, 'url', 'src', 'href');
      return url ? linkLine(attrText(node, 'title', 'caption') ?? url, links.href(url)) : [];
    }
    case 'database':
    case 'page': {
      const id = pageIdOf(node);
      const page = id === undefined ? null : links.page(id);
      return page ? linkLine(page.title, page.href) : [];
    }
    case 'tab': {
      const title = attrText(node, 'title', 'label', 'name');
      const body = blockLines(children, links);
      return title ? [`**${escapeMarkdown(title)}**`, '', ...body] : body;
    }
    case 'skip':
      return [];
    default:
      if (isInline(node)) return paragraph([node], links);
      if (children.length > 0 && children.every(isInline)) return paragraph(children, links);
      return blockLines(children, links);
  }
}

/** Blocks one after another, with a blank line between them. */
function blockLines(nodes: readonly ContentNode[], links: ExportLinks): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    const lines = block(node, links);
    if (lines.length === 0) continue;
    if (out.length > 0) out.push('');
    out.push(...lines);
  }
  return out;
}

/** The whole page as a Markdown file. */
export function pageToMarkdown(page: ExportPage, links: ExportLinks): string {
  const title = page.title.replace(/\s+/g, ' ').trim() || 'Untitled';
  const lines = [`# ${title}`];
  const properties = (page.properties ?? []).map(
    ({ name, value }) => `${escapeMarkdown(name)}: ${escapeMarkdown(value.replace(/\s+/g, ' '))}`,
  );
  if (properties.length > 0) lines.push('', ...properties);
  const body = blockLines(page.blocks, links);
  if (body.length > 0) lines.push('', ...body);
  return `${lines.join('\n')}\n`;
}
