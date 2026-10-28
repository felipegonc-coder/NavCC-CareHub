import {
  PLAN_LINK,
  type ImportProblem,
  type PlanContent,
  type PlanNode,
} from '@carehub/extras/import-export/import/index';

// The Import screen's HTML reader: a page's HTML (a saved web page, an Evernote note, a
// Confluence page) as an editor document, read with the browser's DOMParser and the page schema
// as the allowlist (docs/extras/import-export.md). What the schema has no block for is kept as
// text or links, or left out, and listed in the problems. The server checks the document against
// the schema again (prepareDoc), so this only has to get it right.
//
// The page schema, as packages/editor/src/schema.ts and blocks/ make it (the web app doesn't load
// the editor's schema): paragraph, heading (level 1 to 3), bulletList, orderedList (start, type),
// listItem and taskItem (checked) with a paragraph first, taskList, codeBlock (language, plain
// text), blockquote, horizontalRule and hardBreak; marks bold, italic, underline, strike, code
// (alone) and link (href).

/** What the reader gets with each document. */
export interface HtmlContext {
  /** Names the item in the problems. */
  source: string;
  /**
   * A link's or picture's address in the plan (`carehub-import:<key>` or a web address), or null
   * to keep only the text (or leave the picture out).
   */
  link: (href: string) => string | null;
}

export interface HtmlContent {
  content: PlanContent;
  problems: ImportProblem[];
}

interface Marks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  /** The link's address, already checked. */
  link?: string | null;
}

/** Where the reader is: the marks on the text, how deep it is in the HTML and in blocks. */
interface Scope {
  marks: Marks;
  depth: number;
  /** Lists and quotes around it. */
  level: number;
}

/**
 * Lists and quotes inside each other, at most; deeper ones are kept as paragraphs at that level.
 * The server takes documents up to 100 nodes deep.
 */
const MAX_LEVEL = 30;
/** Elements inside each other that are read as HTML; deeper ones are read as plain text. */
const MAX_DEPTH = 500;

const ELEMENT = 1;
const TEXT = 3;

const names = (list: string) => new Set(list.split(' '));
/** Left out with what's in them: not content, or controls. */
const LEFT_OUT = names(
  'head title meta link base script noscript style template svg math canvas map button input ' +
    'select textarea datalist option optgroup output progress meter dialog frameset frame ' +
    'noframes noembed param source track',
);
/** Left out, and listed in the problems: pages can't show them yet. */
const EMBEDS = names('iframe object embed video audio');
/** Elements that start and end a paragraph. */
const BLOCKS = names(
  'address article aside body caption center dd details div dl dt fieldset figcaption figure ' +
    'footer form header hgroup legend li main nav p search section summary tbody td tfoot th ' +
    'thead tr',
);
const HEADINGS = names('h1 h2 h3 h4 h5 h6');
const CODE_BLOCKS = names('pre listing xmp plaintext');
const CODE = names('code kbd samp tt');
const LISTS = names('ul ol menu dir');
const CALLOUTS = names('aside figure div');

/** Characters that aren't text: controls other than tabs and line ends, and byte order marks. */
const CONTROLS = /[^\P{Cc}\t\n\r\f]|\uFEFF/gu;
const SPACES = /[ \t\n\r\f]+/g;
const FONT_WEIGHT = /(?:^|;)\s*font-weight\s*:\s*([^;]*)/i;
const FONT_STYLE = /(?:^|;)\s*font-style\s*:\s*([^;]*)/i;
const TEXT_DECORATION = /(?:^|;)\s*text-decoration(?:-line)?\s*:\s*([^;]*)/i;
const DISPLAY_NONE = /(?:^|;)\s*display\s*:\s*none/i;
const LANGUAGE = /^[\w#+.-]{1,40}$/;
const PLAN_ADDRESS = new RegExp(`^${PLAN_LINK}[A-Za-z0-9_-]{1,64}$`);

/**
 * A web address a link may keep, or null: links keep only http, https, mailto and tel (spec 3.1),
 * and `//host` is https. The server checks them again with the editor's rule.
 */
function webAddress(href: string): string | null {
  const value = href.trim();
  if (/^(?:https?|mailto|tel):/i.test(value)) return value;
  if (!/^[/\\]{2}/.test(value)) return null;
  const url = `https://${value.replace(/^[/\\]+/, '')}`;
  try {
    return new URL(url).host === '' ? null : url;
  } catch {
    return null;
  }
}

function styleValue(element: Element, pattern: RegExp): string | undefined {
  const style = element.getAttribute('style')?.toLowerCase() ?? '';
  return pattern.exec(style)?.[1]?.replace('!important', '').trim();
}

const isHidden = (element: Element) =>
  element.hasAttribute('hidden') || DISPLAY_NONE.test(element.getAttribute('style') ?? '');

function isBold(weight: string): boolean | null {
  if (weight === 'bold' || weight === 'bolder') return true;
  if (weight === 'normal' || weight === 'lighter') return false;
  return /^\d+$/.test(weight) ? Number(weight) >= 600 : null;
}

/** The marks for text with `marks`; the code mark goes with no other, and a link wins over it. */
function markList(marks: Marks): PlanNode['marks'] {
  if (marks.code && !marks.link) return [{ type: 'code' }];
  const list: NonNullable<PlanNode['marks']> = [];
  for (const type of ['bold', 'italic', 'underline', 'strike'] as const) {
    if (marks[type]) list.push({ type });
  }
  if (marks.link) list.push({ type: 'link', attrs: { href: marks.link } });
  return list.length ? list : undefined;
}

const sameMarks = (a: PlanNode, b: PlanNode) =>
  JSON.stringify(a.marks ?? null) === JSON.stringify(b.marks ?? null);

const paragraph = (content: PlanNode[]): PlanNode =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' };

/** Blocks being read, with the paragraph being gathered from the text between them. */
class Blocks {
  readonly nodes: PlanNode[] = [];
  private line: PlanNode[] = [];
  /** A line break was read: `<div><br></div>` is an empty line, `<div></div>` is nothing. */
  private broken = false;

  text(value: string, marks: Marks) {
    let text = value.replace(CONTROLS, '').replace(SPACES, ' ');
    const last = this.line.at(-1);
    if (text.startsWith(' ') && (last?.type !== 'text' || last.text?.endsWith(' '))) {
      text = text.slice(1);
    }
    if (!text) return;
    const list = markList(marks);
    const node: PlanNode = { type: 'text', text, ...(list && { marks: list }) };
    if (last?.type === 'text' && sameMarks(last, node)) last.text += text;
    else this.line.push(node);
  }

  lineBreak() {
    this.trimEnd();
    this.line.push({ type: 'hardBreak' });
    this.broken = true;
  }

  /** Ends the paragraph being gathered. */
  end() {
    this.trimEnd();
    // A break at the end of a block draws no line of its own.
    if (this.line.at(-1)?.type === 'hardBreak') this.line.pop();
    if (this.line.length || this.broken) this.nodes.push(paragraph(this.line));
    this.line = [];
    this.broken = false;
  }

  add(...blocks: PlanNode[]) {
    this.end();
    this.nodes.push(...blocks);
  }

  done(): PlanNode[] {
    this.end();
    return this.nodes;
  }

  private trimEnd() {
    const last = this.line.at(-1);
    if (last?.type !== 'text' || !last.text?.endsWith(' ')) return;
    last.text = last.text.slice(0, -1);
    if (!last.text) this.line.pop();
  }
}

/** Blocks as one line of text, with a line break between them (for headings and table rows). */
function flatten(blocks: PlanNode[]): PlanNode[] {
  const line: PlanNode[] = [];
  const append = (content: PlanNode[]) => {
    if (!content.length) return;
    if (line.length) line.push({ type: 'hardBreak' });
    line.push(...content);
  };
  const visit = (node: PlanNode) => {
    if (node.type === 'paragraph' || node.type === 'heading') append(node.content ?? []);
    else if (node.type === 'codeBlock') {
      const code = node.content?.[0]?.text ?? '';
      for (const text of code.split('\n')) {
        if (text) append([{ type: 'text', text, marks: [{ type: 'code' }] }]);
      }
    } else node.content?.forEach(visit);
  };
  blocks.forEach(visit);
  return line;
}

/** A list item's blocks: the schema wants a paragraph first. */
function listItem(blocks: PlanNode[], checked: boolean | null): PlanNode {
  const [first, ...rest] = blocks;
  const content =
    first?.type === 'paragraph'
      ? blocks
      : first?.type === 'heading'
        ? [paragraph(first.content ?? []), ...rest]
        : [paragraph([]), ...blocks];
  return checked === null
    ? { type: 'listItem', content }
    : { type: 'taskItem', attrs: { checked }, content };
}

const elementChildren = (element: Element, name: string) =>
  Array.from(element.children).filter((child) => child.localName === name);

/** A list item's own checkbox, as in `<li><input type="checkbox" checked> To do</li>`. */
function checkbox(item: Element): Element | null {
  for (const input of Array.from(item.getElementsByTagName('input'))) {
    if (input.closest('li') !== item) continue;
    if (input.getAttribute('type')?.toLowerCase() === 'checkbox') return input;
  }
  return null;
}

/** To-dos: a Care Hub task list, or a list whose every item starts with a checkbox. */
function isTaskList(list: Element): boolean {
  if (list.getAttribute('data-type') === 'taskList') return true;
  const items = elementChildren(list, 'li');
  return (
    items.length > 0 &&
    items.every((item) => item.getAttribute('data-type') === 'taskItem' || checkbox(item))
  );
}

const isChecked = (item: Element) =>
  item.getAttribute('data-checked') === 'true' ||
  (checkbox(item)?.hasAttribute('checked') ?? false);

/** Numbered lists keep where they start and their style (`1`, `a` or `i`), as blocks/lists.ts. */
function orderedAttrs(list: Element): Record<string, unknown> | null {
  const start = Number.parseInt(list.getAttribute('start') ?? '', 10);
  const style = list.getAttribute('type')?.toLowerCase();
  const attrs = {
    ...(Number.isSafeInteger(start) && start !== 1 && { start }),
    ...((style === '1' || style === 'a' || style === 'i') && { type: style }),
  };
  return Object.keys(attrs).length ? attrs : null;
}

/** Heading 1 to 3; Care Hub copies them as `<h2>` to `<h4>` with data-level (blocks/text.ts). */
function headingLevel(heading: Element): number {
  const level = Number(heading.localName.charAt(1));
  const stored = Number(heading.getAttribute('data-level'));
  return stored >= 1 && stored <= 3 && stored === level - 1 ? stored : Math.min(level, 3);
}

/** A code block's text: as written, with a new line for each `<br>` and block inside. */
function codeText(element: Element, depth: number): string {
  let text = '';
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === TEXT) text += (child as Text).data;
    if (child.nodeType !== ELEMENT) continue;
    const inner = child as Element;
    const name = inner.localName;
    if (LEFT_OUT.has(name) || isHidden(inner)) continue;
    if (name === 'br') {
      text += '\n';
      continue;
    }
    const part = depth > MAX_DEPTH ? (inner.textContent ?? '') : codeText(inner, depth + 1);
    if (!BLOCKS.has(name)) text += part;
    else if (part) text += `${text && !text.endsWith('\n') ? '\n' : ''}${part}\n`;
  }
  return text;
}

/** From `<pre><code class="language-js">`, `data-language` or `lang-js`. */
function codeLanguage(pre: Element): string | null {
  for (const element of [pre, ...elementChildren(pre, 'code')]) {
    const named = element.getAttribute('data-language') ?? element.getAttribute('data-lang');
    const fromClass = Array.from(element.classList)
      .find((name) => /^(?:language|lang)-./.test(name))
      ?.replace(/^(?:language|lang)-/, '');
    const language = (named || fromClass)?.trim().toLowerCase();
    if (language && LANGUAGE.test(language)) return language;
  }
  return null;
}

function codeBlock(pre: Element, depth: number): PlanNode {
  const text = codeText(pre, depth).replace(CONTROLS, '').replace(/\n$/, '');
  const language = codeLanguage(pre);
  return {
    type: 'codeBlock',
    ...(language && { attrs: { language } }),
    ...(text && { content: [{ type: 'text', text }] }),
  };
}

/** A picture's name for its link: its alt text, title or file name. */
function pictureName(picture: Element, src: string): string {
  const named = picture.getAttribute('alt')?.trim() || picture.getAttribute('title')?.trim();
  if (named) return named;
  const file = src.startsWith('data:') ? '' : (src.split(/[?#]/)[0] ?? '').split('/').at(-1);
  try {
    return decodeURIComponent(file ?? '').trim() || 'Picture';
  } catch {
    return file || 'Picture';
  }
}

/** Tracking pixels and spacers: no one put them there to be read. */
const isPixel = (picture: Element) =>
  ['width', 'height'].every((name) => /^[01](?:px)?$/.test(picture.getAttribute(name) ?? ''));

class HtmlReader {
  private readonly found = { links: 0, missing: 0, tables: 0, callouts: 0, embeds: 0 };
  /** Elements already read another way (a callout's icon). */
  private readonly skip = new Set<Element>();

  constructor(private readonly context: HtmlContext) {}

  /** An element's content as blocks. */
  read(element: Element, scope: Scope): PlanNode[] {
    return this.readNodes(Array.from(element.childNodes), scope);
  }

  /** Each kind of thing pages can't show, once ("2 pictures kept as links", spec 3.2). */
  problems(): ImportProblem[] {
    const { links, missing, tables, callouts, embeds } = this.found;
    const file = this.context.source;
    const problems: ImportProblem[] = [];
    const add = (n: number, one: string, many: string, why: string) => {
      const what = `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
      if (n > 0) problems.push({ file, what, why });
    };
    add(
      links,
      'picture kept as a link',
      'pictures kept as links',
      "Pages can't show pictures yet.",
    );
    const lost = missing === 1 ? "Its file wasn't found." : "Their files weren't found.";
    add(missing, 'picture left out', 'pictures left out', lost);
    const lines = "Pages can't show tables yet, so each row is a line.";
    add(tables, 'table kept as text', 'tables kept as text', lines);
    const quotes = "Pages can't show callouts yet.";
    add(callouts, 'callout kept as a quote', 'callouts kept as quotes', quotes);
    const media = ['video, sound or frame left out', 'videos, sounds or frames left out'] as const;
    add(embeds, ...media, "Pages can't show them yet.");
    return problems;
  }

  private readNodes(nodes: Node[], scope: Scope): PlanNode[] {
    const out = new Blocks();
    for (const node of nodes) this.walk(node, scope, out);
    return out.done();
  }

  private walk(node: Node, scope: Scope, out: Blocks): void {
    if (node.nodeType === TEXT) return out.text((node as Text).data, scope.marks);
    if (node.nodeType !== ELEMENT) return;
    const element = node as Element;
    const name = element.localName;
    if (LEFT_OUT.has(name) || this.skip.has(element) || isHidden(element)) return;
    if (EMBEDS.has(name)) {
      this.found.embeds += 1;
      return;
    }
    if (scope.depth > MAX_DEPTH) return out.text(element.textContent ?? '', scope.marks);
    const inner = { ...scope, marks: this.marks(element, scope.marks), depth: scope.depth + 1 };
    if (name === 'br') return out.lineBreak();
    if (name === 'hr') return out.add({ type: 'horizontalRule' });
    if (name === 'img') return this.picture(element, inner, out);
    if (CODE_BLOCKS.has(name)) return out.add(codeBlock(element, inner.depth));
    if (HEADINGS.has(name)) {
      const content = flatten(this.read(element, inner));
      if (!content.length) return out.end();
      return out.add({ type: 'heading', attrs: { level: headingLevel(element) }, content });
    }
    if (name === 'table') return this.table(element, inner, out);
    if (inner.level < MAX_LEVEL) {
      if (LISTS.has(name)) return this.list(element, inner, out);
      if (name === 'blockquote') return this.quote(element, inner, out);
      if (CALLOUTS.has(name) && element.classList.contains('callout')) {
        return this.callout(element, inner, out);
      }
    }
    const block = BLOCKS.has(name) || LISTS.has(name) || name === 'blockquote';
    if (block) out.end();
    for (const child of Array.from(element.childNodes)) this.walk(child, inner, out);
    if (block) out.end();
  }

  /** The marks inside `element`: from its tag, its style and its link. */
  private marks(element: Element, marks: Marks): Marks {
    const name = element.localName;
    const next = { ...marks };
    if (name === 'b' || name === 'strong') next.bold = true;
    if (name === 'i' || name === 'em') next.italic = true;
    if (name === 'u' || name === 'ins') next.underline = true;
    if (name === 's' || name === 'strike' || name === 'del') next.strike = true;
    if (CODE.has(name)) next.code = true;
    const href = name === 'a' ? element.getAttribute('href') : null;
    if (href !== null) next.link = this.address(href);
    // Word and Google Docs say it with styles: <b style="font-weight:normal"> isn't bold.
    const weight = styleValue(element, FONT_WEIGHT);
    const bold = weight === undefined ? null : isBold(weight);
    if (bold !== null) next.bold = bold;
    const style = styleValue(element, FONT_STYLE);
    if (style === 'normal') next.italic = false;
    if (style?.startsWith('italic') || style?.startsWith('oblique')) next.italic = true;
    const decoration = styleValue(element, TEXT_DECORATION) ?? '';
    // Links are drawn underlined already (Google Docs underlines them with a style).
    if (decoration.includes('underline') && !next.link) next.underline = true;
    if (decoration.includes('line-through')) next.strike = true;
    return next;
  }

  /** The address to link to: the importer's, if it's a plan link or a web address. */
  private address(href: string): string | null {
    const address = this.context.link(href);
    if (address === null) return null;
    return PLAN_ADDRESS.test(address) ? address : webAddress(address);
  }

  /** Pages can't show pictures yet: a picture is a link to its file, named by its alt text. */
  private picture(picture: Element, scope: Scope, out: Blocks) {
    if (isPixel(picture)) return;
    const src = picture.getAttribute('src')?.trim() ?? '';
    const href = src ? this.address(src) : null;
    if (href === null) {
      this.found.missing += 1;
      return;
    }
    this.found.links += 1;
    out.text(pictureName(picture, src), { ...scope.marks, link: href });
  }

  private list(list: Element, scope: Scope, out: Blocks) {
    const task = isTaskList(list);
    const inner = { ...scope, level: scope.level + 1 };
    const items: PlanNode[] = [];
    for (const node of Array.from(list.childNodes)) {
      if (node.nodeType === ELEMENT && (node as Element).localName === 'li') {
        const item = node as Element;
        if (isHidden(item)) continue;
        const blocks = this.read(item, { ...inner, marks: this.marks(item, inner.marks) });
        items.push(listItem(blocks, task ? isChecked(item) : null));
        continue;
      }
      // Anything else right inside a list (often a list) goes in the item before it.
      const blocks = this.readNodes([node], inner);
      if (!blocks.length) continue;
      const last = items.at(-1);
      if (last?.content) last.content.push(...blocks);
      else items.push(listItem(blocks, task ? false : null));
    }
    if (!items.length) return out.end();
    const type = task ? 'taskList' : list.localName === 'ol' ? 'orderedList' : 'bulletList';
    const attrs = type === 'orderedList' ? orderedAttrs(list) : null;
    out.add({ type, ...(attrs && { attrs }), content: items });
  }

  private quote(quote: Element, scope: Scope, out: Blocks) {
    const blocks = this.read(quote, { ...scope, level: scope.level + 1 });
    if (!blocks.length) return out.end();
    out.add({ type: 'blockquote', content: blocks });
  }

  /**
   * Pages can't show callouts yet: a callout is a quote, starting with its icon. As the
   * importers write them: `<aside class="callout">`, its icon in `.callout-icon`.
   */
  private callout(callout: Element, scope: Scope, out: Blocks) {
    const icon = Array.from(callout.getElementsByClassName('callout-icon')).find(
      (element) => element.closest('.callout') === callout,
    );
    if (icon) this.skip.add(icon);
    const blocks = this.read(callout, { ...scope, level: scope.level + 1 });
    const text = icon?.textContent?.replace(SPACES, ' ').trim();
    if (text) {
      const first = blocks[0]?.type === 'paragraph' ? blocks[0] : undefined;
      const rest = first?.content ?? [];
      const start: PlanNode = { type: 'text', text: rest.length ? `${text} ` : text };
      if (first) first.content = [start, ...rest];
      else blocks.unshift(paragraph([start]));
    }
    if (!blocks.length) return out.end();
    this.found.callouts += 1;
    out.add({ type: 'blockquote', content: blocks });
  }

  /**
   * Pages can't show tables yet: each row is a line, its cells between " | ". A row with one
   * cell keeps that cell's blocks, so tables that only lay a page out read as before.
   */
  private table(table: Element, scope: Scope, out: Blocks) {
    const rows: Element[] = [];
    for (const child of Array.from(table.children)) {
      if (child.localName === 'caption') out.add(...this.read(child, scope));
      if (child.localName === 'tr') rows.push(child);
      if (['thead', 'tbody', 'tfoot'].includes(child.localName)) {
        rows.push(...elementChildren(child, 'tr'));
      }
    }
    let kept = false;
    for (const row of rows) {
      const cells = Array.from(row.children)
        .filter((cell) => (cell.localName === 'td' || cell.localName === 'th') && !isHidden(cell))
        .map((cell) => this.read(cell, { ...scope, marks: this.marks(cell, scope.marks) }))
        .filter((blocks) => blocks.length > 0);
      if (cells.length === 1) out.add(...(cells[0] ?? []));
      if (cells.length < 2) continue;
      kept = true;
      const line: PlanNode[] = [];
      for (const blocks of cells) {
        const content = flatten(blocks);
        if (line.length && content.length) line.push({ type: 'text', text: ' | ' });
        line.push(...content);
      }
      out.add(paragraph(line));
    }
    if (kept) this.found.tables += 1;
  }
}

/**
 * A page's HTML as an editor document for the plan, and what couldn't come in. Never runs the
 * HTML's scripts or loads its pictures: DOMParser's documents are inert.
 */
export function htmlToContent(html: string, context: HtmlContext): HtmlContent {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const reader = new HtmlReader(context);
  const blocks = reader.read(parsed.body, { marks: {}, depth: 0, level: 0 });
  // Empty lines at the very start and end of a page are left out.
  const isEmpty = (node?: PlanNode) => node?.type === 'paragraph' && !node.content;
  while (isEmpty(blocks[0])) blocks.shift();
  while (isEmpty(blocks.at(-1))) blocks.pop();
  return {
    content: { doc: { type: 'doc', content: blocks.length ? blocks : [paragraph([])] } },
    problems: reader.problems(),
  };
}
