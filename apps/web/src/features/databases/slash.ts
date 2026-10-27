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

/**
 * The page a path shows (`/p/<pageId>`), or null. The editor doesn't give its page yet, so the
 * entry takes the page from the address.
 */
export function pageIdFromPath(pathname: string): string | null {
  const encoded = /^\/p\/([^/]+)/.exec(pathname)?.[1];
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

/**
 * Makes an inline database in the page at `pathname` and adds its block: where the cursor was,
 * or where it is now if the page changed in the meantime. Nothing is added once the editor is
 * gone. Rejects when the path isn't a page or the database can't be made.
 */
export async function addDatabaseBlock(editor: SlashEditor, pathname: string): Promise<void> {
  const parentId = pageIdFromPath(pathname);
  if (!parentId) throw new Error(`"/database" needs a page, not ${pathname}.`);
  const { doc, selection } = editor.state;
  const database = await api.post<DatabaseWithVersion>('/api/databases', {
    parentId,
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
  run(editor: SlashEditor): void {
    addDatabaseBlock(editor, window.location.pathname).catch((error: unknown) => {
      console.error("Couldn't add the database.", error);
    });
  },
};
