import type { AnyExtension } from '@tiptap/core';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useEffect, useMemo, useRef } from 'react';
import type * as Y from 'yjs';
import { createBlockExtensions } from './extensions';
import { PAGE_FIELD } from './schema';
import { SlashMenu } from './SlashMenu';
import { SlashMenuStore } from './slash';
import { SelectionToolbar } from './Toolbar';
import type {
  BubbleItem,
  CollabProvider,
  EditorUser,
  LinkPicker,
  NodeViews,
  SlashItem,
} from './types';
import './styles.css';

export interface BlockEditorProps {
  /** The page's Y.Doc. Works on its own; a `provider` on the same doc shares it live. */
  ydoc: Y.Doc;
  /** XML fragment in `ydoc` that holds the blocks (default `PAGE_FIELD`, "default"). */
  field?: string;
  /**
   * The ID of the page shown. "/" menu entries get it when they run (`context.pageId`), for things
   * they make on the page, like an inline database. Can change at any time.
   */
  pageId?: string | null;
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
   * More "/" menu entries, after the blocks' own. An entry with the id of a block (like
   * `heading1`) replaces it. Can change at any time.
   */
  slashItems?: SlashItem[];
  /** More ways to choose a link target in the link panel, like "Link to a lesson". */
  linkPickers?: LinkPicker[];
  /**
   * More buttons in the selection toolbar: `comment` right after Link, the others after the
   * formatting buttons. Items with `readOnly` also show when `editable` is false.
   */
  bubbleItems?: BubbleItem[];
  /**
   * More behavior that isn't a node or mark, like shortcuts or plugins. Read when the editor is
   * created: remount the editor (with a `key`) to change them.
   */
  extensions?: AnyExtension[];
}

/**
 * The page editor: blocks, the "/" menu, the selection toolbar and Markdown shortcuts on a Y.Doc,
 * live with a collab provider.
 */
export function BlockEditor({
  ydoc,
  field = PAGE_FIELD,
  pageId = null,
  provider,
  user,
  editable = true,
  placeholder,
  ariaLabel = 'Page content',
  className,
  onReady,
  nodeViews,
  slashItems,
  linkPickers,
  bubbleItems,
  extensions,
}: BlockEditorProps) {
  const awareness = provider?.awareness ?? null;
  const latest = useRef({ placeholder, onReady });
  latest.current = { placeholder, onReady };
  const userId = user?.id;
  // The blocks you used last are offered first, per person on this device.
  const slashMenu = useMemo(
    () => new SlashMenuStore(userId ? `carehub.editor.recent-blocks.${userId}` : undefined),
    [userId],
  );

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
        slashMenu,
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
    slashMenu.setItems(slashItems);
  }, [slashMenu, slashItems]);

  useEffect(() => {
    slashMenu.setPageId(pageId);
  }, [slashMenu, pageId]);

  useEffect(() => {
    if (editor) latest.current.onReady?.(editor);
  }, [editor]);

  if (!editor) return null;
  const toolbar = editable || (bubbleItems?.some((item) => item.readOnly) ?? false);
  return (
    <div className={className ? `ch-block-editor ${className}` : 'ch-block-editor'}>
      <EditorContent editor={editor} />
      {editable && <SlashMenu editor={editor} store={slashMenu} />}
      {toolbar && (
        <SelectionToolbar
          key={editable ? 'edit' : 'view'}
          editor={editor}
          readOnly={!editable}
          linkPickers={linkPickers}
          bubbleItems={bubbleItems}
        />
      )}
    </div>
  );
}
