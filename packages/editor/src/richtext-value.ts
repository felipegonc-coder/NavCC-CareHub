// What a rich text field's value may hold, and the cleanup that gets it there. No React, styles
// or editor code, so the server can load it (it's also in `@carehub/editor/schema`).
import type { JSONContent } from '@tiptap/core';
import { safeHref } from './links';

export const RICH_TEXT_MARKS = ['bold', 'italic', 'underline', 'strike', 'code', 'link'] as const;
export type RichTextMark = (typeof RICH_TEXT_MARKS)[number];

export interface RichTextOptions {
  marks: readonly RichTextMark[];
  singleLine: boolean;
}

/**
 * How deep the cleanup goes into a value; anything nested deeper is dropped, so a crafted value
 * can't overflow the stack. That's room for real content: a list nested 20 levels deep is 42
 * levels of JSON.
 */
const MAX_DEPTH = 64;

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
    // Only a safe href is kept: where a link opens comes from its href when it is drawn.
    const href = safeHref(isRecord(mark) && isRecord(mark.attrs) ? mark.attrs.href : undefined);
    if (href !== null) out.push({ type, attrs: { href } });
  }
  return out.length ? out : undefined;
}

/** The inline content of `node`: text with allowed marks and hard breaks (flattens the rest). */
function inline(node: unknown, options: RichTextOptions, out: JSONContent[], depth: number) {
  if (!isRecord(node) || depth > MAX_DEPTH) return;
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
    node.content.forEach((child) => inline(child, options, out, depth + 1));
  }
}

const isInline = (node: unknown) =>
  isRecord(node) && (node.type === 'text' || node.type === 'hardBreak');

/** Every text block inside `node` (headings, list items, quotes...) as a paragraph. */
function paragraphs(node: unknown, options: RichTextOptions, out: JSONContent[], depth: number) {
  if (!isRecord(node) || depth > MAX_DEPTH) return;
  const content = Array.isArray(node.content) ? node.content : [];
  if (node.type === 'paragraph' || content.some(isInline)) {
    const children: JSONContent[] = [];
    content.forEach((child) => inline(child, options, children, depth + 1));
    out.push(paragraph(children));
  } else {
    content.forEach((child) => paragraphs(child, options, out, depth + 1));
  }
}

/**
 * Turns any stored value into what a rich text field may hold: paragraphs of text and hard
 * breaks, with only the allowed marks and safe links. Single-line fields get one paragraph.
 * Text next to text with the same marks is joined, so the result matches the editor's JSON.
 */
export function sanitizeRichText(value: unknown, options: RichTextOptions): JSONContent {
  let blocks: JSONContent[] = [];
  if (isRecord(value) && value.type === 'doc') paragraphs(value, options, blocks, 0);
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
