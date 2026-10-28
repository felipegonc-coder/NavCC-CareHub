/**
 * The "/database" entry of the page editor's "/" menu: makes an inline database in the page
 * (title "Untitled database", a Name property and a Table view) and adds its block where "/" was.
 */
import { Table } from 'lucide-react';
import { createElement } from 'react';
import { api } from '../../lib/api';
import type { DatabaseWithVersion } from './api';

/** The block that shows an inline database (`packages/editor/src/lanes/databases.ts`). */
export interface DatabaseBlockContent {
  type: 'database';
  attrs: { databaseId: string };
}

/** The parts of the Tiptap editor the entry uses; the real `Editor` fits. */
export interface SlashEditor {
  readonly isDestroyed: boolean;
  readonly state: { readonly doc: unknown; readonly selection: { readonly from: number } };
  readonly commands: {
    insertContentAt(position: number, content: DatabaseBlockContent): boolean;
  };
}

/** What the entry gets besides the editor when it runs; the editor's `SlashContext` fits. */
export interface SlashRunContext {
  /** The page being edited, or null if the editor has none. */
  readonly pageId: string | null;
}

/**
 * Makes an inline database in the page `pageId` and adds its block: where the cursor was, or
 * where it is now if the page changed in the meantime. Nothing is added once the editor is gone.
 * Rejects when there's no page or the database can't be made.
 */
export async function addDatabaseBlock(editor: SlashEditor, pageId: string | null): Promise<void> {
  if (!pageId) throw new Error('"/database" needs the page being edited.');
  const { doc, selection } = editor.state;
  const database = await api.post<DatabaseWithVersion>('/api/databases', {
    parentId: pageId,
    inline: true,
  });
  if (editor.isDestroyed) return;
  const at = editor.state.doc === doc ? selection.from : editor.state.selection.from;
  editor.commands.insertContentAt(at, { type: 'database', attrs: { databaseId: database.id } });
}

/** The "/" menu entry, listed under "Database". */
export const databaseSlashItem = {
  id: 'database',
  title: 'Database',
  group: 'Database',
  keywords: ['table', 'inline'],
  icon: createElement(Table, { size: 18 }),
  run(editor: SlashEditor, context: SlashRunContext): void {
    addDatabaseBlock(editor, context.pageId).catch((error: unknown) => {
      console.error("Couldn't add the database.", error);
    });
  },
};
