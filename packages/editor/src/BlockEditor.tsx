import type { AnyExtension } from '@tiptap/core';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { createBlockExtensions, type NodeViews } from './extensions';
import { PAGE_FIELD } from './schema';
import type { CollabProvider, EditorUser } from './types';
import './styles.css';

export interface BlockEditorProps {
  /** The page's Y.Doc. Works on its own; a `provider` on the same doc shares it live. */
  ydoc: Y.Doc;
  /** XML fragment in `ydoc` that holds the blocks (default `PAGE_FIELD`, "default"). */
  field?: string;
  /** The collab provider of `ydoc`. With `user`, carets and selections show for everyone. */
  provider?: CollabProvider | null;
  /** You, as others see you next to your caret. */
  user?: EditorUser;
  editable?: boolean;
  /** Shown in an empty page (default: "Type '/' for commands"). */
  placeholder?: string;
  /** Accessible name of the editing area (default "Page content"); read when it mounts. */
  ariaLabel?: string;
  className?: string;
  onReady?: (editor: Editor) => void;
  /**
   * React views of lane blocks (nodes in `lanes/`) by node name, like `{ database: DatabaseView }`.
   * Read when the editor is created, like `extensions`.
   */
  nodeViews?: NodeViews;
  /**
   * More behavior that isn't a node or mark, like shortcuts or plugins. Read when the editor is
   * created: remount the editor (with a `key`) to change them.
   */
  extensions?: AnyExtension[];
}

/** The page editor: blocks and Markdown shortcuts on a Y.Doc, live with a collab provider. */
export function BlockEditor({
  ydoc,
  field = PAGE_FIELD,
  provider,
  user,
  editable = true,
  placeholder,
  ariaLabel = 'Page content',
  className,
  onReady,
  nodeViews,
  extensions,
}: BlockEditorProps) {
  const awareness = provider?.awareness ?? null;
  const latest = useRef({ placeholder, onReady });
  latest.current = { placeholder, onReady };

  // A new provider or person makes a new editor; the blocks stay in the Y.Doc.
  const editor = useEditor(
    {
      editable,
      shouldRerenderOnTransaction: false,
      extensions: createBlockExtensions({
        ydoc,
        field,
        provider: awareness ? { awareness } : null,
        user,
        nodeViews,
        extensions,
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
    [ydoc, field, awareness, user?.id, user?.name, user?.color],
  );

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(editable, false);
  }, [editor, editable]);

  useEffect(() => {
    if (editor) latest.current.onReady?.(editor);
  }, [editor]);

  if (!editor) return null;
  return (
    <div className={className ? `ch-block-editor ${className}` : 'ch-block-editor'}>
      <EditorContent editor={editor} />
    </div>
  );
}
