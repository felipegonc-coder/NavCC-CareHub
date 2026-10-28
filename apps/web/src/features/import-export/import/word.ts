import type { ImportProblem } from '@carehub/extras/import-export/import/index';

// The Import screen's Word reader (Import and export spec, section 3.2; IE-02): a .docx file's
// document as HTML for htmlToContent (./html), read with the browser's DOMParser. Headings come
// from Word's heading styles; lists, tables, pictures, links and footnotes come along. Tracked
// changes come in accepted: insertions are kept and deletions left out. Comments are left out.
// Google Docs' "Download as Word" files are the same format.
//
// Elements are matched by their local names, since writers use different prefixes.

/** The .docx's parts the reader uses, as parsed XML. */
export interface WordParts {
  document: Document;
  /** The document's relationships by id: a picture's zip path, or a link's address. */
  links: ReadonlyMap<string, string>;
  styles?: Document | null;
  numbering?: Document | null;
  footnotes?: Document | null;
  endnotes?: Document | null;
}

export interface WordHtml {
  /** The text of the first paragraph when it's styled Title or Heading 1 (left out of `html`). */
  title: string | null;
  /** The document as HTML; pictures have their zip path as `src`. */
  html: string;
  /** What's left out: comments, embedded objects, equations' layout. */
  problems: ImportProblem[];
}

type Marks = { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean };

interface Style {
  /** Its name in lower case: "heading 1", "title", "quote". */
  name: string;
  basedOn: string | null;
  /** <w:outlineLvl>: 0 for a level 1 heading, 9 for body text. */
  outline: number | null;
  /** A paragraph style's <w:numPr>, for list styles. */
  numbering: Element | undefined;
  /** A character style's marks (Strong, Emphasis). */
  marks: Marks;
}

type Numbering = { numId: string; level: number };

/** `format` is <w:numFmt>: bullet, decimal, lowerLetter, upperRoman… */
type ListLevel = { format: string; start: number };

/** A list being written: its `<ul>` or `<ol>`, and the item the next level goes in. */
type OpenList = { numId: string; level: number; list: HTMLElement; item: HTMLElement | null };

const RELATIONSHIP = /\/relationships$/;
const OFF = /^(?:0|false|off|none)$/i;
/** Writers' wrappers around runs and paragraphs; what's in them is read as if they weren't there. */
const WRAPPERS = new Set(['ins', 'moveTo', 'smartTag', 'customXml', 'fldSimple', 'dir', 'bdo']);

const kids = (element: Element | null | undefined, name?: string): Element[] =>
  Array.from(element?.children ?? []).filter((kid) => name === undefined || kid.localName === name);
const first = (element: Element | null | undefined, name: string) => kids(element, name)[0];
/** The elements called `name` anywhere inside `element`. */
const inside = (element: Element, name: string) =>
  Array.from(element.getElementsByTagNameNS('*', name));

/** An attribute by its local name; relationship ids (`r:id`, `r:embed`) with `relationship`. */
function attr(element: Element | null | undefined, name: string, relationship = false) {
  for (const attribute of Array.from(element?.attributes ?? [])) {
    const isRelationship = RELATIONSHIP.test(attribute.namespaceURI ?? '');
    if (attribute.localName === name && isRelationship === relationship) return attribute.value;
  }
  return null;
}

const valueOf = (element: Element | null | undefined, name: string) =>
  attr(first(element, name), 'val');

function numberOf(value: string | null): number | null {
  const number = value === null ? NaN : Number.parseInt(value, 10);
  return Number.isSafeInteger(number) ? number : null;
}

/** A toggle such as <w:b/>: on unless its value is 0, false, off or none; unset when missing. */
function toggle(props: Element | undefined, name: string): boolean | undefined {
  const element = first(props, name);
  return element && !OFF.test(attr(element, 'val') ?? '');
}

function marksOf(props: Element | undefined): Marks {
  return {
    bold: toggle(props, 'b'),
    italic: toggle(props, 'i'),
    underline: toggle(props, 'u'),
    strike: toggle(props, 'strike') ?? toggle(props, 'dstrike'),
  };
}

function readStyles(styles: Document | null | undefined): Map<string, Style> {
  const found = new Map<string, Style>();
  for (const style of kids(styles?.documentElement, 'style')) {
    const id = attr(style, 'styleId');
    if (id === null) continue;
    const props = first(style, 'pPr');
    found.set(id, {
      name: (valueOf(style, 'name') ?? '').toLowerCase(),
      basedOn: valueOf(style, 'basedOn'),
      outline: numberOf(valueOf(props, 'outlineLvl')),
      numbering: first(props, 'numPr'),
      marks: marksOf(first(style, 'rPr')),
    });
  }
  return found;
}

/** Each list's levels by numId, with the list's own start numbers. */
function readNumbering(
  numbering: Document | null | undefined,
): Map<string, Map<number, ListLevel>> {
  const root = numbering?.documentElement;
  const abstracts = new Map<string, Map<number, ListLevel>>();
  for (const abstract of kids(root, 'abstractNum')) {
    const levels = new Map<number, ListLevel>();
    for (const level of kids(abstract, 'lvl')) {
      levels.set(numberOf(attr(level, 'ilvl')) ?? 0, {
        format: valueOf(level, 'numFmt') ?? 'decimal',
        start: numberOf(valueOf(level, 'start')) ?? 1,
      });
    }
    abstracts.set(attr(abstract, 'abstractNumId') ?? '', levels);
  }
  const lists = new Map<string, Map<number, ListLevel>>();
  for (const num of kids(root, 'num')) {
    const levels = new Map(abstracts.get(valueOf(num, 'abstractNumId') ?? ''));
    for (const override of kids(num, 'lvlOverride')) {
      const level = numberOf(attr(override, 'ilvl')) ?? 0;
      const start = numberOf(valueOf(override, 'startOverride'));
      const base = levels.get(level);
      if (base && start !== null) levels.set(level, { ...base, start });
    }
    lists.set(attr(num, 'numId') ?? '', levels);
  }
  return lists;
}

/** Notes by id, without Word's separator lines. */
function readNotes(notes: Document | null | undefined): Map<string, Element> {
  const found = new Map<string, Element>();
  for (const note of kids(notes?.documentElement)) {
    const id = attr(note, 'id');
    if (id !== null && !/separator|continuation/i.test(attr(note, 'type') ?? ''))
      found.set(id, note);
  }
  return found;
}

const count = (n: number, what: string) =>
  `${n.toLocaleString('en-US')} ${what}${n === 1 ? '' : 's'}`;

class WordReader {
  /** Inert, as DOMParser's documents are: nothing in it runs or loads. */
  private readonly page = new DOMParser().parseFromString('', 'text/html');
  private readonly styles: Map<string, Style>;
  private readonly lists: Map<string, Map<number, ListLevel>>;
  private readonly footnotes: Map<string, Element>;
  private readonly endnotes: Map<string, Element>;
  /** Items numbered so far, by numId and level, so a list goes on after a paragraph. */
  private readonly numbered = new Map<string, number[]>();
  private readonly notes: Element[] = [];
  /** Text boxes in the paragraph being read: they come after it, as paragraphs. */
  private boxes: Element[] = [];
  private inNote = false;
  private readonly found = { comments: 0, objects: 0, equations: 0 };

  constructor(private readonly parts: WordParts) {
    this.styles = readStyles(parts.styles);
    this.lists = readNumbering(parts.numbering);
    this.footnotes = readNotes(parts.footnotes);
    this.endnotes = readNotes(parts.endnotes);
  }

  read(source: string): WordHtml {
    const { body } = this.page;
    this.blocks(kids(first(this.parts.document.documentElement, 'body')), body);
    if (this.notes.length > 0) {
      const heading = this.page.createElement('h2');
      heading.textContent = 'Notes';
      const list = this.page.createElement('ol');
      this.inNote = true;
      for (const note of this.notes) {
        const item = this.page.createElement('li');
        this.blocks(kids(note), item);
        list.append(item);
      }
      body.append(heading, list);
    }
    const opening = Array.from(body.children).find(
      (element) => element.textContent?.trim() || element.querySelector('img'),
    );
    const title =
      opening?.localName === 'h1' ? opening.textContent?.replace(/\s+/g, ' ').trim() : '';
    if (title) opening?.remove();
    const { comments, objects, equations } = this.found;
    const problems = [
      [comments, `${count(comments, 'comment')} left out`, "Word comments aren't brought in."],
      [objects, `${count(objects, 'embedded object')} left out`, "Pages can't show them yet."],
      [equations, `${count(equations, 'equation')} kept as text`, "Pages can't show them yet."],
    ] as const;
    return {
      title: title || null,
      html: body.innerHTML,
      problems: problems
        .filter(([n]) => n > 0)
        .map(([, what, why]): ImportProblem => ({ file: source, what, why })),
    };
  }

  /** The styles from `id` up through the ones it's based on. */
  private *chain(id: string | null): Generator<Style> {
    const seen = new Set<string>();
    for (let next = id; next !== null && !seen.has(next);) {
      seen.add(next);
      const style = this.styles.get(next);
      if (!style) return;
      yield style;
      next = style.basedOn;
    }
  }

  /** Body elements, cells and notes: paragraphs, lists and tables. */
  private blocks(elements: readonly Element[], into: HTMLElement) {
    const open: OpenList[] = [];
    for (const element of elements) {
      const name = element.localName;
      if (WRAPPERS.has(name)) this.blocks(kids(element), into);
      else if (name === 'sdt') this.blocks(kids(first(element, 'sdtContent')), into);
      else if (name === 'tbl') {
        open.length = 0;
        into.append(this.table(element));
      } else if (name === 'p') {
        this.paragraph(element, into, open);
        const boxes = this.boxes;
        this.boxes = [];
        for (const box of boxes) {
          open.length = 0;
          this.blocks(kids(box), into);
        }
      }
    }
  }

  private table(table: Element): HTMLElement {
    const out = this.page.createElement('table');
    for (const row of kids(table, 'tr')) {
      const line = this.page.createElement('tr');
      const header = toggle(first(row, 'trPr'), 'tblHeader');
      for (const cell of kids(row, 'tc')) {
        const into = this.page.createElement(header ? 'th' : 'td');
        this.blocks(kids(cell), into);
        line.append(into);
      }
      out.append(line);
    }
    return out;
  }

  private paragraph(paragraph: Element, into: HTMLElement, open: OpenList[]) {
    const props = first(paragraph, 'pPr');
    const styleId = valueOf(props, 'pStyle');
    const level = this.headingLevel(props, styleId);
    const numbering = level === null ? this.numberingOf(props, styleId) : null;
    const quote = [...this.chain(styleId)].some((style) => /^(?:intense )?quote$/.test(style.name));
    const out = this.page.createElement(level !== null ? `h${Math.min(level, 6)}` : 'p');
    this.inline(kids(paragraph), out, false);
    if (numbering === null) {
      open.length = 0;
      const last = into.lastElementChild;
      if (!quote) into.append(out);
      else if (last?.localName === 'blockquote') last.append(out);
      else into.append(this.wrap('blockquote', out));
      return;
    }
    const { numId, level: depth } = numbering;
    while ((open.at(-1)?.level ?? -1) > depth) open.pop();
    if (open.at(-1)?.level === depth && open.at(-1)?.numId !== numId) open.pop();
    let top = open.at(-1);
    if (top?.level !== depth) {
      top = { numId, level: depth, list: this.list(numId, depth), item: null };
      (open.at(-1)?.item ?? into).append(top.list);
      open.push(top);
    }
    const counts = this.numbered.get(numId) ?? [];
    counts[depth] = (counts[depth] ?? 0) + 1;
    counts.length = depth + 1;
    this.numbered.set(numId, counts);
    top.item = this.wrap('li', out);
    top.list.append(top.item);
  }

  private headingLevel(props: Element | undefined, styleId: string | null): number | null {
    const outline = numberOf(valueOf(props, 'outlineLvl'));
    if (outline !== null) return outline < 9 ? outline + 1 : null;
    for (const style of this.chain(styleId)) {
      const heading = /^heading ([1-9])$/.exec(style.name);
      if (heading) return Number(heading[1]);
      if (style.name === 'title') return 1;
      if (style.outline !== null) return style.outline < 9 ? style.outline + 1 : null;
    }
    return null;
  }

  private numberingOf(props: Element | undefined, styleId: string | null): Numbering | null {
    const own = first(props, 'numPr');
    const styled = [...this.chain(styleId)].find((style) => style.numbering)?.numbering;
    const numId = valueOf(own, 'numId') ?? valueOf(styled, 'numId');
    const level = numberOf(valueOf(own, 'ilvl') ?? valueOf(styled, 'ilvl')) ?? 0;
    // A numId of 0 takes the numbering off.
    if (numId === null || numId === '0') return null;
    return { numId, level: Math.min(Math.max(level, 0), 8) };
  }

  /** A new `<ul>` or `<ol>` for the list's level, numbered on from its items so far. */
  private list(numId: string, depth: number): HTMLElement {
    const level = this.lists.get(numId)?.get(depth);
    const format = level?.format ?? 'bullet';
    if (format === 'bullet' || format === 'none') return this.page.createElement('ul');
    const list = this.page.createElement('ol');
    const start = (level?.start ?? 1) + (this.numbered.get(numId)?.[depth] ?? 0);
    if (start !== 1) list.setAttribute('start', String(start));
    // html.ts keeps `a` and `i` (lower case), as numbered lists show them.
    const type = /letter/i.test(format) ? 'a' : /roman/i.test(format) ? 'i' : null;
    if (type) list.setAttribute('type', type);
    return list;
  }

  private inline(elements: readonly Element[], out: Element, inLink: boolean) {
    for (const element of elements) {
      const name = element.localName;
      if (name === 'r') this.run(element, out, inLink);
      else if (WRAPPERS.has(name)) this.inline(kids(element), out, inLink);
      else if (name === 'sdt') this.inline(kids(first(element, 'sdtContent')), out, inLink);
      else if (name === 'hyperlink') {
        const address = this.links().get(attr(element, 'id', true) ?? '');
        if (address === undefined || inLink) {
          this.inline(kids(element), out, inLink);
          continue;
        }
        const link = this.page.createElement('a');
        link.setAttribute('href', address);
        out.append(link);
        this.inline(kids(element), link, true);
      } else if (name === 'oMath' || name === 'oMathPara') {
        this.found.equations += 1;
        out.append(element.textContent ?? '');
      }
    }
  }

  private run(run: Element, out: Element, inLink: boolean) {
    const props = first(run, 'rPr');
    if (toggle(props, 'vanish')) return;
    const own = marksOf(props);
    const styled = [...this.chain(valueOf(props, 'rStyle'))].map((style) => style.marks);
    const mark = (name: keyof Marks) =>
      own[name] ?? styled.find((marks) => marks[name] !== undefined)?.[name] ?? false;
    const tags = [
      mark('bold') && 'b',
      mark('italic') && 'i',
      mark('underline') && !inLink && 'u',
      mark('strike') && 's',
    ].filter((tag): tag is string => typeof tag === 'string');
    const text = (value: string) => {
      let node: Node = this.page.createTextNode(value);
      for (const tag of tags) node = this.wrap(tag, node);
      out.append(node);
    };
    this.runParts(kids(run), out, text);
  }

  private runParts(parts: readonly Element[], out: Element, text: (value: string) => void) {
    for (const part of parts) {
      const name = part.localName;
      if (name === 't') text(part.textContent ?? '');
      else if (name === 'tab' || name === 'ptab') text('\t');
      else if (name === 'noBreakHyphen') text('-');
      else if (name === 'cr' || (name === 'br' && !/page|column/.test(attr(part, 'type') ?? ''))) {
        out.append(this.page.createElement('br'));
      } else if (name === 'drawing' || name === 'pict') this.pictures(part, out);
      else if (name === 'AlternateContent') {
        const choice = first(part, 'Choice') ?? first(part, 'Fallback');
        this.runParts(kids(choice), out, text);
      } else if (name === 'footnoteReference' || name === 'endnoteReference') {
        const notes = name === 'footnoteReference' ? this.footnotes : this.endnotes;
        const note = notes.get(attr(part, 'id') ?? '');
        if (!note || this.inNote) continue;
        this.notes.push(note);
        out.append(`[${this.notes.length}]`);
      } else if (name === 'commentReference') this.found.comments += 1;
      else if (name === 'object') this.found.objects += 1;
    }
  }

  /** A drawing's pictures, as `<img>` with their zip path; its text boxes come after. */
  private pictures(drawing: Element, out: Element) {
    const boxes = inside(drawing, 'txbxContent');
    const inBox = (node: Element) => boxes.some((box) => box.contains(node));
    const names = inside(drawing, 'docPr')[0];
    for (const picture of [...inside(drawing, 'blip'), ...inside(drawing, 'imagedata')]) {
      if (inBox(picture)) continue;
      const id =
        attr(picture, 'embed', true) ?? attr(picture, 'id', true) ?? attr(picture, 'link', true);
      const image = this.page.createElement('img');
      const src = this.links().get(id ?? '');
      if (src !== undefined) image.setAttribute('src', src);
      const alt = attr(names, 'descr') || attr(names, 'title') || attr(picture, 'title');
      if (alt) image.setAttribute('alt', alt);
      out.append(image);
    }
    this.boxes.push(
      ...boxes.filter((box) => !boxes.some((other) => other !== box && other.contains(box))),
    );
  }

  /** Notes have relationships of their own, which aren't read: their links are kept as text. */
  private links(): ReadonlyMap<string, string> {
    return this.inNote ? new Map() : this.parts.links;
  }

  private wrap(tag: string, node: Node): HTMLElement {
    const element = this.page.createElement(tag);
    element.append(node);
    return element;
  }
}

/** The document of a .docx as HTML for htmlToContent, with its title and what's left out. */
export function readWord(parts: WordParts, source: string): WordHtml {
  return new WordReader(parts).read(source);
}
