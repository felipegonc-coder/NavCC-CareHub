import { LIMITS, newId as randomId, plainText, richTextLength } from '../format/index';
import type { Block, Link, Mark, Paragraph, RichText, TextRun } from '../format/index';
import { uniqueIds } from './ids';
import { hrefToLink, limitRichText, normalizeRichText } from './richtext';
import type { BlockOf, IdGen } from './types';

// Pasted text (plain or simple Markdown) to tidy blocks, in one pass over the lines: fenced code, tables
// (Markdown pipes or cells copied from a spreadsheet), headings, dividers, quotes and callouts, lists and
// paragraphs. Paragraphs next to each other share one paragraph block. Text without any blank line (as word
// processors copy it) has one paragraph per line; otherwise a blank line starts a new paragraph and a single
// line break stays a line break. Inline **bold**, *italic*, ~~strike~~, <u>underline</u>, `code` and
// [links](https://…) become marks and links, and bare https:// addresses become links.

type ListStyle = BlockOf<'list'>['style'];
type Tone = BlockOf<'callout'>['tone'];
type OpenList = { style: ListStyle; items: string[] };

const INLINE = new RegExp(
  [
    String.raw`\\(?<esc>[!-/:-@[-\x60{-~])`,
    String.raw`(?<tick>\x60+)(?<code>[^\x60]|[^\x60][\s\S]*?[^\x60])\k<tick>(?!\x60)`,
    String.raw`!?\[(?<label>[^\]]*)\]\(\s*<?(?<href>[^\s()<>]*)>?(?:\s+"[^"]*")?\s*\)`,
    String.raw`<(?<auto>(?:https://|mailto:)[^\s<>]+)>`,
    String.raw`(?<bare>(?:https://|mailto:)[^\s<>]*[^\s<>.,;:!?'")\]}])`,
    String.raw`\*\*\*(?=\S)(?<bi>[\s\S]*?\S)\*\*\*`,
    String.raw`\*\*(?=\S)(?<b>[\s\S]*?\S)\*\*`,
    String.raw`(?<![A-Za-z0-9])__(?=\S)(?<b2>[\s\S]*?\S)__(?![A-Za-z0-9])`,
    String.raw`~~(?=\S)(?<s>[\s\S]*?\S)~~`,
    String.raw`\*(?=[^\s*])(?<i>[\s\S]*?[^\s*])\*`,
    String.raw`(?<![A-Za-z0-9])_(?=[^\s_])(?<i2>[\s\S]*?[^\s_])_(?![A-Za-z0-9])`,
    String.raw`<u>(?<u>[\s\S]*?)</u>`,
  ].join('|'),
  'g',
);

const NESTED: [group: string, marks: Mark[]][] = [
  ['bi', ['bold', 'italic']],
  ['b', ['bold']],
  ['b2', ['bold']],
  ['s', ['strike']],
  ['i', ['italic']],
  ['i2', ['italic']],
  ['u', ['underline']],
];

function inlineRuns(text: string, marks: Mark[], link: Link | undefined, out: TextRun[]): void {
  const push = (value: string, extra: Mark[] = [], to = link) => {
    if (value !== '')
      out.push({ text: value, marks: [...marks, ...extra], ...(to ? { link: to } : {}) });
  };
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    const g = match.groups ?? {};
    push(text.slice(at, match.index));
    at = match.index + match[0].length;
    const href = g.href ?? g.auto ?? g.bare ?? '';
    const to = link ?? hrefToLink(href) ?? undefined;
    const nested = NESTED.find(([name]) => g[name] !== undefined);
    if (g.esc !== undefined) push(g.esc);
    else if (g.code !== undefined) push(g.code, ['code']);
    else if (g.label !== undefined) inlineRuns(g.label.trim() || href, marks, to, out);
    else if (href !== '') push(href, [], to);
    else if (nested) inlineRuns(g[nested[0]] ?? '', [...marks, ...nested[1]], link, out);
  }
  push(text.slice(at));
}

/** One paragraph of rich text from Markdown-style text ("\n" stays a line break). */
function inlineParagraph(text: string): Paragraph {
  const runs: TextRun[] = [];
  inlineRuns(text, [], undefined, runs);
  return normalizeRichText([{ runs }])[0] ?? { runs: [] };
}

const plain = (text: string, max = Infinity): string =>
  plainText([inlineParagraph(text)]).slice(0, max);
const isBlank = (line: string): boolean => line.trim() === '';

// ---------- Lines ----------

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w#+.-]*)/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const DIVIDER = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const TABLE_RULE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const ITEMS: [ListStyle, RegExp][] = [
  ['checkbox', /^[ \t]*[-*+•][ \t]+\[[ xX]\][ \t]+(.*)$/],
  ['bulleted', /^[ \t]*[-*+•●◦▪‣–][ \t]+(.*)$/],
  ['numbered', /^[ \t]*\d{1,9}[.)][ \t]+(.*)$/],
];
const ALERT = /^\[!(note|tip|important|warning|caution|success)\][ \t]*(.*)$/i;
const ATTRIBUTION = /^[ \t]*(?:—|–|--|~)[ \t]*(\S.*)$/;
const PREFIX =
  /^(?:\*\*|__)?(note|tip|warning|caution|important|success)(?:\*\*|__)?[ \t]*[:：][ \t]*(?:\*\*|__)?[ \t]*/i;
const EMOJI = /^(💡|⚠️?|🚨|❗️?|ℹ️?|📝|✅)[ \t]*/u;

// prettier-ignore
const TONES: Record<string, Tone> = {
  note: 'note', important: 'note', 'ℹ': 'note', '📝': 'note', tip: 'tip', '💡': 'tip', warning: 'warning',
  caution: 'warning', '⚠': 'warning', '🚨': 'warning', '❗': 'warning', success: 'success', '✅': 'success',
};
const toneOf = (word = ''): Tone => TONES[word.toLowerCase().replace(/\uFE0F/g, '')] ?? 'note';
const calloutStart = (line: string) => PREFIX.exec(line) ?? EMOJI.exec(line);

function cells(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  return row
    .split(/(?<!\\)\|/)
    .map((cell) => plain(cell.trim().replace(/\\\|/g, '|'), LIMITS.tableCell));
}

/** Prose lines to paragraphs: a blank line starts a new one, and so does every line when `breaks` is off. */
function paragraphs(lines: string[], breaks: boolean): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  const end = () => {
    if (current.length > 0) out.push(current);
    current = [];
  };
  for (const line of lines) {
    if (isBlank(line)) end();
    else current.push(line.trim());
    if (!breaks) end();
  }
  end();
  return out;
}

const richText = (groups: string[][]): RichText =>
  limitRichText(groups.map((lines) => inlineParagraph(lines.join('\n'))));

/**
 * Pasted text as new blocks (with ids from `newId`), ready for `addBlocks`. Understands plain text and simple
 * Markdown: `#` headings, lists (`-`, `1.`, `- [ ]`), `>` quotes, `> [!TIP]` and `Note:` callouts, `---`
 * dividers, fenced code, and tables (Markdown or copied from a spreadsheet). Only https:, mailto: and page
 * ("/p/<pageId>") links are kept; other links keep just their text. Returns [] for blank text.
 */
export function pasteToBlocks(text: string, newId: IdGen = randomId): Block[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .split('\n');
  const breaks = lines.some((line, i) => isBlank(line) && i > 0 && i < lines.length - 1);
  const id = uniqueIds(new Set(), newId);
  const out: Block[] = [];
  let prose: string[] = [];
  let list: OpenList | null = null;

  const flushProse = () => {
    let open: Paragraph[] | null = null;
    for (const group of paragraphs(prose, breaks)) {
      const callout = calloutStart(group[0] ?? '');
      if (callout) {
        open = null;
        const body = [(group[0] ?? '').slice(callout[0].length), ...group.slice(1)];
        out.push({ id: id(), type: 'callout', tone: toneOf(callout[1]), text: richText([body]) });
        continue;
      }
      const [paragraph] = richText([group]);
      if (!paragraph) continue;
      const fits =
        open !== null &&
        open.length < LIMITS.paragraphs &&
        richTextLength(open) + richTextLength([paragraph]) <= LIMITS.richText;
      if (fits && open) open.push(paragraph);
      else {
        open = [paragraph];
        out.push({ id: id(), type: 'paragraph', text: open });
      }
    }
    prose = [];
  };
  const flushList = () => {
    for (let i = 0; list && i < list.items.length; i += LIMITS.listItems) {
      const blockId = id();
      const items = list.items
        .slice(i, i + LIMITS.listItems)
        .map((item) => ({ id: id(), text: [inlineParagraph(item)] }));
      out.push({ id: blockId, type: 'list', style: list.style, items });
    }
    list = null;
  };
  const flush = () => {
    flushProse();
    flushList();
  };
  const take = (from: number, keep: (line: string) => boolean): string[] => {
    let end = from;
    while (end < lines.length && keep(lines[end] ?? '')) end++;
    return lines.slice(from, end);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const next = lines[i + 1] ?? '';
    const fence = FENCE.exec(line);
    const firstCell = (row: string) => !isBlank(row.split('\t')[0] ?? '');
    const tabs = line.split('\t').length;
    const heading = HEADING.exec(line);
    const item = ITEMS.find(([, pattern]) => pattern.test(line));

    if (fence) {
      flush();
      const close = new RegExp(
        `^ {0,3}${fence[1]?.[0] === '~' ? '~' : '`'}{${fence[1]?.length ?? 3},}[ \\t]*$`,
      );
      const body = take(i + 1, (row) => !close.test(row));
      i += body.length + 1;
      const language = (fence[2] ?? '').slice(0, LIMITS.label);
      out.push({
        id: id(),
        type: 'code',
        code: body.join('\n').slice(0, LIMITS.code),
        ...(language ? { language } : {}),
      });
    } else if (
      line.includes('|') &&
      next.includes('|') &&
      next.includes('-') &&
      TABLE_RULE.test(next)
    ) {
      flush();
      const body = take(i + 2, (row) => row.includes('|') && !isBlank(row));
      i += body.length + 1;
      out.push(...tables([line, ...body].map(cells), true, id));
    } else if (tabs > 1 && next.split('\t').length === tabs && firstCell(line) && firstCell(next)) {
      flush();
      const rows = take(i, (row) => row.split('\t').length === tabs);
      i += rows.length - 1;
      out.push(
        ...tables(
          rows.map((row) => row.split('\t').map((cell) => plain(cell.trim(), LIMITS.tableCell))),
          false,
          id,
        ),
      );
    } else if (heading && plain(heading[2] ?? '').length <= LIMITS.title) {
      flush();
      const level = Math.min(heading[1]?.length ?? 1, 3) as 1 | 2 | 3;
      out.push({ id: id(), type: 'heading', level, text: plain(heading[2] ?? '') });
    } else if (DIVIDER.test(line)) {
      flush();
      out.push({ id: id(), type: 'divider', style: 'line' });
    } else if (QUOTE.test(line)) {
      flush();
      const quoted = take(i, (row) => QUOTE.test(row));
      i += quoted.length - 1;
      out.push(
        ...quoteBlock(
          quoted.map((row) => QUOTE.exec(row)?.[1] ?? ''),
          id,
        ),
      );
    } else if (item) {
      // An indented item joins the open list (the format has no nested lists).
      const style = list && /^[ \t]/.test(line) ? list.style : item[0];
      flushProse();
      if (!list || list.style !== style) {
        flushList();
        list = { style, items: [] } as OpenList;
      }
      list.items.push((item[1].exec(line)?.[1] ?? '').trim());
    } else if (list && /^[ \t]+\S/.test(line)) {
      list.items.push(`${list.items.pop() ?? ''} ${line.trim()}`.trim());
    } else if (isBlank(line)) {
      if (!list && prose.length > 0) prose.push('');
    } else {
      flushList();
      prose.push(heading ? (heading[2] ?? '') : line);
    }
  }
  flush();
  return out;
}

function tables(rows: string[][], headerRow: boolean, id: IdGen): Block[] {
  const width = Math.min(Math.max(1, ...rows.map((row) => row.length)), LIMITS.tableColumns);
  const even = rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ''));
  const header = headerRow ? even.slice(0, 1) : [];
  const body = headerRow ? even.slice(1) : even;
  const per = LIMITS.tableRows - header.length;
  const out: Block[] = [];
  for (let i = 0; i < body.length || out.length === 0; i += per) {
    out.push({ id: id(), type: 'table', headerRow, rows: [...header, ...body.slice(i, i + per)] });
  }
  return out;
}

function quoteBlock(lines: string[], id: IdGen): Block[] {
  const alert = ALERT.exec(lines[0] ?? '');
  if (alert) {
    const body = paragraphs([alert[2] ?? '', ...lines.slice(1)], true);
    return [{ id: id(), type: 'callout', tone: toneOf(alert[1]), text: richText(body) }];
  }
  const by = lines.length > 1 ? ATTRIBUTION.exec(lines[lines.length - 1] ?? '') : null;
  const quoted = by ? lines.slice(0, -1) : lines;
  const text = quoted
    .map((line) => plain(line))
    .join('\n')
    .trim();
  if (text === '') return [];
  if (text.length > LIMITS.longText) {
    return [{ id: id(), type: 'paragraph', text: richText(paragraphs(quoted, true)) }];
  }
  const attribution = plain(by?.[1] ?? '', LIMITS.title).trim();
  return [{ id: id(), type: 'quote', text, ...(attribution ? { attribution } : {}) }];
}
