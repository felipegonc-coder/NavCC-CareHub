import type { AnyExtension } from '@tiptap/core';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { createBlockExtensions } from './extensions';
import { SlashMenuStore } from './slash';
import { SlashMenu } from './SlashMenu';
import type { SlashItem } from './types';
import './styles.css';

export interface EditorUser {
  id: string;
  name: string;
  /** CSS color for this person's caret, like `#2563eb`. */
  color: string;
}

export interface BlockEditorProps {
  /** The page's Y.Doc. Works on its own; connect a provider to share it. */
  ydoc: Y.Doc;
  /** Name of the XML fragment in `ydoc` that holds the page (default `default`). */
  field?: string;
  user: EditorUser;
  /** The provider's awareness. When set, other people's carets and selections show. */
  awareness?: Awareness | null;
  editable?: boolean;
  /** Shown in an empty page (default: "Type '/' for commands"). */
  placeholder?: string;
  /** Accessible name of the editing area (default "Page content"); read when it mounts. */
  ariaLabel?: string;
  className?: string;
  onReady?: (editor: Editor) => void;
  /**
   * More Tiptap nodes, marks and extensions, like a database block with a React node view.
   * Read when the editor is created: remount the editor (with a `key`) to change them.
   */
  extensions?: AnyExtension[];
  /** More "/" menu entries. One with the id of a basic block (like `heading1`) replaces it. */
  slashItems?: SlashItem[];
}

/** The page editor: blocks, a "/" menu and Markdown shortcuts, on Yjs. */
export function BlockEditor({
  ydoc,
  field = 'default',
  user,
  awareness = null,
  editable = true,
  placeholder,
  ariaLabel = 'Page content',
  className,
  onReady,
  extensions,
  slashItems,
}: BlockEditorProps) {
  const [slashMenu] = useState(() => new SlashMenuStore());
  const latest = useRef({ user, placeholder, onReady });
  latest.current = { user, placeholder, onReady };

  const editor = useEditor(
    {
      editable,
      shouldRerenderOnTransaction: false,
      extensions: createBlockExtensions({
        ydoc,
        field,
        awareness,
        slashMenu,
        extensions,
        user: latest.current.user,
        placeholder: () => latest.current.placeholder,
      }),
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': ariaLabel,
          class: 'ch-editor',
        },
      },
    },
    [ydoc, field, awareness, slashMenu],
  );

  useEffect(() => {
    slashMenu.setItems(slashItems);
  }, [slashMenu, slashItems]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(editable, false);
  }, [editor, editable]);

  const { id, name, color } = user;
  useEffect(() => {
    if (editor && awareness) editor.commands.updateUser({ id, name, color });
  }, [editor, awareness, id, name, color]);

  useEffect(() => {
    if (editor) latest.current.onReady?.(editor);
  }, [editor]);

  if (!editor) return null;
  return (
    <div className={className ? `ch-block-editor ${className}` : 'ch-block-editor'}>
      <EditorContent editor={editor} />
      {editable && <SlashMenu editor={editor} store={slashMenu} />}
    </div>
  );
}
