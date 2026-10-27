import { Extension, Node, type Extensions } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { Placeholder } from '@tiptap/extensions';
import { StarterKit } from '@tiptap/starter-kit';
import type { RichTextMark, RichTextOptions } from './richtext-value';
import { SafeLink } from './schema';
import { ToolbarKeys } from './toolbar-keys';

/** Puts pasted lines on one line: line breaks (and the spaces around them) become one space. */
export const toSingleLine = (text: string) =>
  text.replace(/\s+/g, (space) => (/[\r\n]/.test(space) ? ' ' : space));

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
      link: false,
    }),
    ...(marks.includes('link') ? [SafeLink] : []),
    Placeholder.configure({ placeholder: ({ editor }) => (editor.isEmpty ? placeholder() : '') }),
    ToolbarKeys,
    ...(singleLine ? [SingleLine] : []),
  ];
}
