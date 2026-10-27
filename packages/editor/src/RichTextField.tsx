import type { JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo, useRef } from 'react';
import { pageHref } from './links';
import {
  RICH_TEXT_MARKS,
  flattenSlice,
  richTextExtensions,
  sanitizeRichText,
  toSingleLine,
  type RichTextMark,
} from './richtext';
import { SelectionToolbar } from './Toolbar';
import type { LinkPicker } from './types';
import './styles.css';

export interface RichTextFieldProps {
  /** Tiptap JSON (`{ type: 'doc', content: [...] }`). Anything else is cleaned up first. */
  value: JSONContent;
  /** Gets the cleaned-up JSON after each change. */
  onChange(value: JSONContent): void;
  ariaLabel: string;
  placeholder?: string;
  /** The marks people can use (default: all six). */
  marks?: RichTextMark[];
  /** One paragraph: Enter adds nothing and pasted line breaks become spaces. */
  singleLine?: boolean;
  autoFocus?: boolean;
  readOnly?: boolean;
  id?: string;
  ariaDescribedBy?: string;
  /** Adds "Link to a page" to the link panel; the link points to `/p/<pageId>`. */
  onPickPage?: () => Promise<{ id: string; title: string } | null>;
  /** More ways to choose a link target, like "Link to a lesson". */
  linkPickers?: LinkPicker[];
}

/** "Link to a page": links the selected text to `/p/<pageId>` of the page `pickPage` returns. */
export const pageLinkPicker = (
  pickPage: () => Promise<{ id: string; title: string } | null>,
): LinkPicker => ({
  label: 'Link to a page',
  pick: async () => {
    const page = await pickPage();
    return page ? pageHref(page.id) : null;
  },
});

/** A small rich text input (paragraphs, hard breaks and a few marks) for forms and properties. */
export function RichTextField({
  value,
  onChange,
  ariaLabel,
  placeholder,
  marks = [...RICH_TEXT_MARKS],
  singleLine = false,
  autoFocus = false,
  readOnly = false,
  id,
  ariaDescribedBy,
  onPickPage,
  linkPickers,
}: RichTextFieldProps) {
  // Stable while the same marks are passed, even as a new array on each render.
  const marksKey = RICH_TEXT_MARKS.filter((name) => marks.includes(name)).join(',');
  const options = useMemo(
    () => ({
      marks: RICH_TEXT_MARKS.filter((name) => marksKey.split(',').includes(name)),
      singleLine,
    }),
    [marksKey, singleLine],
  );
  const latest = useRef({ value, onChange, placeholder });
  latest.current = { value, onChange, placeholder };

  const attributes = useMemo(
    () => ({
      role: 'textbox',
      'aria-label': ariaLabel,
      'aria-multiline': String(!singleLine),
      ...(id ? { id } : {}),
      ...(ariaDescribedBy ? { 'aria-describedby': ariaDescribedBy } : {}),
      ...(readOnly ? { 'aria-readonly': 'true' } : {}),
      class: 'ch-editor',
    }),
    [ariaLabel, singleLine, id, ariaDescribedBy, readOnly],
  );

  const editor = useEditor(
    {
      extensions: richTextExtensions(options, () => latest.current.placeholder ?? ''),
      content: sanitizeRichText(latest.current.value, options),
      editable: !readOnly,
      autofocus: autoFocus ? 'end' : false,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes,
        ...(options.singleLine && {
          transformPastedText: toSingleLine,
          transformPasted: (slice, view) => flattenSlice(slice, view.state.schema),
        }),
      },
      onUpdate: ({ editor: e }) => latest.current.onChange(sanitizeRichText(e.getJSON(), options)),
    },
    [options],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setOptions({ editorProps: { ...editor.options.editorProps, attributes } });
  }, [editor, attributes]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  // Replaces the content only when `value` says something else, so the cursor stays put.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const next = sanitizeRichText(value, options);
    if (!editor.schema.nodeFromJSON(next).eq(editor.state.doc)) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [editor, value, options]);

  const pickers = useMemo(
    () => [...(onPickPage ? [pageLinkPicker(onPickPage)] : []), ...(linkPickers ?? [])],
    [onPickPage, linkPickers],
  );

  if (!editor) return null;
  return (
    <div className="ch-richtext" data-readonly={readOnly ? '' : undefined}>
      <EditorContent editor={editor} />
      {!readOnly && <SelectionToolbar editor={editor} linkPickers={pickers} />}
    </div>
  );
}
