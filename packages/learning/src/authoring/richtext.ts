import { ExternalIdSchema, IdSchema, LIMITS, LinkUrlSchema, MarkSchema } from '../format/index';
import type { Link, Mark, Paragraph, RichText, TextRun } from '../format/index';

/** The editor's JSON (Tiptap `JSONContent`): a "doc" of "paragraph"s holding "text" and "hardBreak" nodes. */
export type EditorJson = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: EditorJson[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};

const MARKS: readonly Mark[] = MarkSchema.options;

/** The course the rich text belongs to. Links to its lessons need it: without it they can't be written or read. */
export type LinkOptions = { courseId?: string };

/** Page links as the editor's page picker writes them: "/p/<pageId>". */
const PAGE_HREF = '/p/';
/** Lesson links as the "Link to a lesson" picker writes them. */
const LESSON_HREF = /^\/learning\/courses\/([^/?#]+)\/lessons\/([^/?#]+)(?:#block-([^/?#]+))?$/;

/**
 * The editor's href for a link: the address itself, "/p/<pageId>" for a page, or
 * "/learning/courses/<courseId>/lessons/<lessonId>#block-<blockId>" for a lesson (or a block in it) of the
 * course in `options`. Null for a lesson link when no course is given.
 */
export function linkToHref(link: Link, options: LinkOptions = {}): string | null {
  if (link.kind === 'url') return link.url;
  if (link.kind === 'page') return `${PAGE_HREF}${link.pageId}`;
  if (options.courseId === undefined) return null;
  const block = link.blockId === undefined ? '' : `#block-${link.blockId}`;
  return `/learning/courses/${options.courseId}/lessons/${link.lessonId}${block}`;
}

/**
 * The link for an editor href, or null when the format can't store it. It stores https: and mailto: addresses,
 * pages, and lessons of the course in `options` (a lesson of another course can't be stored).
 */
export function hrefToLink(href: string, options: LinkOptions = {}): Link | null {
  const value = href.trim();
  if (value.startsWith(PAGE_HREF)) {
    const pageId = value.slice(PAGE_HREF.length);
    return ExternalIdSchema.safeParse(pageId).success ? { kind: 'page', pageId } : null;
  }
  const lesson = LESSON_HREF.exec(value);
  if (lesson) {
    const [, courseId, lessonId = '', blockId] = lesson;
    const ok = (id: string) => IdSchema.safeParse(id).success;
    if (courseId !== options.courseId || !ok(lessonId) || (blockId !== undefined && !ok(blockId)))
      return null;
    return blockId === undefined
      ? { kind: 'lesson', lessonId }
      : { kind: 'lesson', lessonId, blockId };
  }
  return LinkUrlSchema.safeParse(value).success ? { kind: 'url', url: value } : null;
}

const sameLink = (a: Link | undefined, b: Link | undefined): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
const sameMarks = (a: readonly Mark[] = [], b: readonly Mark[] = []): boolean =>
  a.length === b.length && a.every((m, i) => m === b[i]);

function run(text: string, marks: readonly Mark[], link: Link | undefined): TextRun {
  const sorted = MARKS.filter((mark) => marks.includes(mark));
  return { text, ...(sorted.length > 0 ? { marks: sorted } : {}), ...(link ? { link } : {}) };
}

/**
 * Tidy rich text: no empty runs, marks in a fixed order without repeats, and neighbouring runs with the same marks
 * and link merged. Returns `rt` itself when it is already tidy, so edits that change nothing can be skipped.
 */
export function normalizeRichText(rt: RichText): RichText {
  const out = rt.map((paragraph): Paragraph => {
    const runs: TextRun[] = [];
    for (const { text, marks = [], link } of paragraph.runs) {
      if (text === '') continue;
      const last = runs[runs.length - 1];
      const next = run(text, marks, link);
      if (last && sameMarks(last.marks, next.marks) && sameLink(last.link, next.link))
        runs[runs.length - 1] = { ...last, text: last.text + text };
      else runs.push(next);
    }
    return { runs };
  });
  return JSON.stringify(out) === JSON.stringify(rt) ? rt : out;
}

/** True when the text has no visible characters (only spaces and line breaks, or nothing). */
export function isBlankRichText(rt: RichText | undefined): boolean {
  return !rt || rt.every((paragraph) => paragraph.runs.every((r) => r.text.trim() === ''));
}

/** Cuts rich text to the format's limits: 20,000 characters, 2,000 paragraphs and 1,000 runs per paragraph. */
export function limitRichText(rt: RichText): RichText {
  let left = LIMITS.richText;
  const out: Paragraph[] = [];
  for (const paragraph of rt.slice(0, LIMITS.paragraphs)) {
    let runs: TextRun[] = [];
    for (const r of paragraph.runs) {
      const text = r.text.slice(0, Math.max(left, 0));
      left -= text.length;
      if (text !== '') runs.push(text === r.text ? r : { ...r, text });
    }
    if (runs.length > LIMITS.runsPerParagraph) {
      const tail = runs
        .slice(LIMITS.runsPerParagraph - 1)
        .map((r) => r.text)
        .join('');
      runs = [...runs.slice(0, LIMITS.runsPerParagraph - 1), { text: tail }];
    }
    out.push({ runs });
    if (left <= 0) break;
  }
  return out;
}

function toNodes(r: TextRun, options: LinkOptions): EditorJson[] {
  const href = r.link ? linkToHref(r.link, options) : null;
  const marks = [
    ...(r.marks ?? []).map((type) => ({ type })),
    ...(href === null ? [] : [{ type: 'link', attrs: { href } }]),
  ];
  const withMarks = (node: EditorJson): EditorJson =>
    marks.length > 0 ? { ...node, marks } : node;
  return r.text
    .split('\n')
    .flatMap((piece, i) => [
      ...(i > 0 ? [withMarks({ type: 'hardBreak' })] : []),
      ...(piece === '' ? [] : [withMarks({ type: 'text', text: piece })]),
    ]);
}

/**
 * Rich text as editor JSON. Empty text is a doc with one empty paragraph, as the editor itself writes it.
 * Links to lessons need the course in `options`; without it they are left out (their text stays).
 */
export function richTextToEditor(rt: RichText, options: LinkOptions = {}): EditorJson {
  const content = rt.map((paragraph): EditorJson => {
    const nodes = paragraph.runs.flatMap((r) => toNodes(r, options));
    return nodes.length > 0 ? { type: 'paragraph', content: nodes } : { type: 'paragraph' };
  });
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

function inlineRuns(node: EditorJson, out: TextRun[], options: LinkOptions): void {
  const marks: Mark[] = [];
  let link: Link | undefined;
  for (const mark of node.marks ?? []) {
    if ((MARKS as readonly string[]).includes(mark.type)) marks.push(mark.type as Mark);
    else if (mark.type === 'link' && typeof mark.attrs?.['href'] === 'string')
      link = hrefToLink(mark.attrs['href'], options) ?? undefined;
  }
  if (node.type === 'text' && typeof node.text === 'string') out.push(run(node.text, marks, link));
  else if (node.type === 'hardBreak') out.push(run('\n', marks, link));
  else for (const child of node.content ?? []) inlineRuns(child, out, options);
}

const isInline = (node: EditorJson): boolean => node.type === 'text' || node.type === 'hardBreak';

function blockParagraphs(node: EditorJson, out: Paragraph[], options: LinkOptions): void {
  const children = node.content ?? [];
  if (isInline(node) || (node.type !== 'doc' && children.every(isInline))) {
    const runs: TextRun[] = [];
    inlineRuns(node, runs, options);
    out.push({ runs });
  } else for (const child of children) blockParagraphs(child, out, options);
}

/**
 * Editor JSON as rich text: paragraphs, line breaks, the five marks and links the format can store (other
 * links keep their text; lesson links need the course in `options`). Anything else the editor holds is read
 * as paragraphs. Cut to the format's limits.
 */
export function editorToRichText(doc: EditorJson, options: LinkOptions = {}): RichText {
  const paragraphs: Paragraph[] = [];
  blockParagraphs(doc.type === 'doc' ? doc : { type: 'doc', content: [doc] }, paragraphs, options);
  const tidy = limitRichText(normalizeRichText(paragraphs));
  return tidy.length === 1 && tidy[0]?.runs.length === 0 ? [] : tidy;
}

/** Rich text for a plain text area: paragraphs separated by a blank line, line breaks kept, formatting dropped. */
export function richTextToTextarea(rt: RichText): string {
  return rt.map((paragraph) => paragraph.runs.map((r) => r.text).join('')).join('\n\n');
}

/**
 * Text area text as rich text: a blank line starts a new paragraph and other line breaks stay. Paragraphs whose
 * text is unchanged keep their formatting from `previous`. With `singleLine`, line breaks become spaces.
 */
export function textareaToRichText(
  value: string,
  previous: RichText = [],
  options: { singleLine?: boolean } = {},
): RichText {
  const text = value.replace(/\r\n?/g, '\n');
  const pieces = options.singleLine
    ? [text.replace(/\s*\n\s*/g, ' ')]
    : text.split(/\n(?:[ \t]*\n)+/);
  const unused = new Map<string, Paragraph[]>();
  for (const paragraph of previous) {
    const key = paragraph.runs.map((r) => r.text).join('');
    unused.set(key, [...(unused.get(key) ?? []), paragraph]);
  }
  const out = pieces
    .map((piece) => piece.replace(/^\n+|\n+$/g, ''))
    .filter((piece) => piece.trim() !== '')
    .map((piece): Paragraph => unused.get(piece)?.shift() ?? { runs: [{ text: piece }] });
  return limitRichText(out);
}
