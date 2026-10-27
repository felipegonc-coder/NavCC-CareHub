import { Extension, Node, type Extensions, type JSONContent } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { Placeholder } from '@tiptap/extensions';
import { StarterKit } from '@tiptap/starter-kit';
import { isSafeHref } from './links';
import { LINK_OPTIONS } from './schema';
import { ToolbarKeys } from './toolbar-keys';

export const RICH_TEXT_MARKS = ['bold', 'italic', 'underline', 'strike', 'code', 'link'] as const;
export type RichTextMark = (typeof RICH_TEXT_MARKS)[number];

export interface RichTextOptions {
  marks: readonly RichTextMark[];
  singleLine: boolean;
}

/** Puts pasted lines on one line: line breaks (and the spaces around them) become one space. */
export const toSingleLine = (text: string) => text.replace(/[^\S\r\n]*[\r\n]+\s*/g, ' ');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const sameMarks = (a: JSONContent['marks'], b: JSONContent['marks']) =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** Adds text to `out`, joined with the text before it when the marks are the same. */
function pushText(out: JSONContent[], text: string, marks?: JSONContent['marks']) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.type === 'text' && typeof last.text === 'string' && sameMarks(last.marks, marks)) {
    last.text += text;
  } else {
    out.push(marks ? { type: 'text', text, marks } : { type: 'text', text });
  }
}

const paragraph = (content: JSONContent[]): JSONContent =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' };

function cleanMarks(marks: unknown, allowed: readonly RichTextMark[]): JSONContent['marks'] {
  const out: NonNullable<JSONContent['marks']> = [];
  for (const mark of Array.isArray(marks) ? marks : []) {
    const type = isRecord(mark) ? mark.type : undefined;
    if (!allowed.some((name) => name === type) || out.some((m) => m.type === type)) continue;
    if (type !== 'link') {
      out.push({ type: type as string });
      continue;
    }
    const attrs = isRecord(mark) && isRecord(mark.attrs) ? mark.attrs : {};
    if (typeof attrs.href !== 'string' || !isSafeHref(attrs.href)) continue;
    const target =
      attrs.target === null || attrs.target === '_blank' ? { target: attrs.target } : {};
    out.push({ type, attrs: { href: attrs.href, ...target } });
  }
  return out.length ? out : undefined;
}

/** The inline content of `node`: text with allowed marks and hard breaks (flattens the rest). */
function inline(node: unknown, options: RichTextOptions, out: JSONContent[]) {
  if (!isRecord(node)) return;
  const lineBreak = () => {
    if (options.singleLine) pushText(out, ' ');
    else out.push({ type: 'hardBreak' });
  };
  if (node.type === 'hardBreak') {
    lineBreak();
  } else if (node.type === 'text' && typeof node.text === 'string') {
    const marks = cleanMarks(node.marks, options.marks);
    node.text.split(/\r\n|\r|\n/).forEach((text, index) => {
      if (index > 0) lineBreak();
      pushText(out, text, marks);
    });
  } else if (Array.isArray(node.content)) {
    node.content.forEach((child) => inline(child, options, out));
  }
}

const isInline = (node: unknown) =>
  isRecord(node) && (node.type === 'text' || node.type === 'hardBreak');

/** Every text block inside `node` (headings, list items, quotes...) as a paragraph. */
function paragraphs(node: unknown, options: RichTextOptions, out: JSONContent[]) {
  if (!isRecord(node)) return;
  const content = Array.isArray(node.content) ? node.content : [];
  if (node.type === 'paragraph' || content.some(isInline)) {
    const children: JSONContent[] = [];
    content.forEach((child) => inline(child, options, children));
    out.push(paragraph(children));
  } else {
    content.forEach((child) => paragraphs(child, options, out));
  }
}

/**
 * Turns any stored value into what a rich text field may hold: paragraphs of text and hard
 * breaks, with only the allowed marks and safe links. Single-line fields get one paragraph.
 * Text next to text with the same marks is joined, so the result matches the editor's JSON.
 */
export function sanitizeRichText(value: unknown, options: RichTextOptions): JSONContent {
  let blocks: JSONContent[] = [];
  if (isRecord(value) && value.type === 'doc') paragraphs(value, options, blocks);
  if (options.singleLine) {
    const line: JSONContent[] = [];
    blocks
      .filter((block) => block.content)
      .forEach((block, index) => {
        if (index > 0) pushText(line, ' ');
        block.content?.forEach((child) => pushText(line, child.text ?? '', child.marks));
      });
    blocks = [paragraph(line)];
  }
  return { type: 'doc', content: blocks.length ? blocks : [paragraph([])] };
}

/** For single-line fields: pasted or dropped blocks become one line of text, keeping marks. */
export function flattenSlice(slice: Slice, schema: Schema): Slice {
  const nodes: PMNode[] = [];
  let first = true;
  slice.content.descendants((node) => {
    if (!node.isTextblock) return true;
    if (!first && node.content.size) nodes.push(schema.text(' '));
    node.forEach((child) => nodes.push(child.type.name === 'hardBreak' ? schema.text(' ') : child));
    first = first && !node.content.size;
    return false;
  });
  if (!nodes.length) return slice.content.firstChild?.isInline ? slice : Slice.empty;
  return new Slice(Fragment.from(schema.nodes.paragraph?.create(null, nodes)), 1, 1);
}

/** Enter, Shift+Enter and Mod+Enter do nothing in a single-line field. */
const SingleLine = Extension.create({
  name: 'singleLine',
  priority: 1000,
  addKeyboardShortcuts: () => ({
    Enter: () => true,
    'Shift-Enter': () => true,
    'Mod-Enter': () => true,
  }),
});

/** The extensions of a rich text field: paragraphs, hard breaks and the allowed marks. */
export function richTextExtensions(
  { marks, singleLine }: RichTextOptions,
  placeholder: () => string = () => '',
): Extensions {
  const mark = (name: RichTextMark) => (marks.includes(name) ? {} : false);
  return [
    Node.create({ name: 'doc', topNode: true, content: singleLine ? 'paragraph' : 'paragraph+' }),
    StarterKit.configure({
      document: false,
      blockquote: false,
      bulletList: false,
      codeBlock: false,
      dropcursor: false,
      gapcursor: false,
      hardBreak: singleLine ? false : {},
      heading: false,
      horizontalRule: false,
      listItem: false,
      listKeymap: false,
      orderedList: false,
      trailingNode: false,
      bold: mark('bold'),
      italic: mark('italic'),
      underline: mark('underline'),
      strike: mark('strike'),
      code: mark('code'),
      link: marks.includes('link') ? LINK_OPTIONS : false,
    }),
    Placeholder.configure({ placeholder: ({ editor }) => (editor.isEmpty ? placeholder() : '') }),
    ToolbarKeys,
    ...(singleLine ? [SingleLine] : []),
  ];
}
