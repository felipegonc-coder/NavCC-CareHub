// The page menu, "…" in the top bar (Pages and blocks, section 3.2): what the person may do with
// the page, then other features' items (pageMenuItems), then Page info.
import type { Editor } from '@carehub/editor';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from '@carehub/ui';
import {
  Archive,
  ArchiveRestore,
  CornerUpRight,
  Link2,
  Lock,
  LockOpen,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { slots } from '../../slots';
import { atLeast } from './access';
import type { EntryActions } from './actions';
import type { PageDetail } from './api';
import { useChangePage } from './change';
import { madeWhen, textCounts } from './page';
import type { TreeNode } from './types';

/** The open page as the sidebar's entry actions take it. */
export const asTreeNode = (page: PageDetail): TreeNode => ({
  id: page.id,
  parentId: page.parentId,
  kind: page.kind === 'database' ? 'database' : 'page',
  title: page.title,
  icon: page.icon,
  position: '',
  hasChildren: false,
  access: page.access,
});

export interface PageMenuProps {
  page: PageDetail;
  actions: EntryActions;
  /** The page's editor, for the word and character counts. */
  editor: Editor | null;
}

/** Items the person can't use are hidden. */
export function PageMenu({ page, actions, editor }: PageMenuProps) {
  const change = useChangePage(page.id);
  const [open, setOpen] = useState(false);
  // "Move to" opens a dialog; the menu mustn't take the focus back from it as it closes.
  const toDialog = useRef(false);
  const { access, locked, archived, deleted } = page;
  const canEdit = atLeast(access, 'edit') && !archived && !deleted;
  const canManage = atLeast(access, 'full') && !deleted;
  const slotPage = { id: page.id, kind: page.kind, title: page.title };
  // Asked each time the menu opens.
  const more = open ? slots.pageMenuItems.filter((item) => item.isVisible?.(slotPage) ?? true) : [];
  const setLocked = (on: boolean) =>
    void change(
      { locked: on },
      { locked: on ? { at: new Date().toISOString(), by: null } : null },
      on ? "Couldn't lock the page." : "Couldn't unlock the page.",
    );
  const setArchived = (on: boolean) =>
    void change(
      { archived: on },
      { archived: on ? { at: new Date().toISOString(), by: null } : null },
      on ? "Couldn't archive the page." : "Couldn't unarchive the page.",
    );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <IconButton label="Page menu">
          <MoreHorizontal aria-hidden />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64"
        onCloseAutoFocus={(event: Event) => {
          if (toDialog.current) event.preventDefault();
          toDialog.current = false;
        }}
      >
        {canEdit && !locked && (
          <DropdownMenuCheckboxItem
            checked={page.fullWidth}
            onCheckedChange={(on: boolean) =>
              void change({ fullWidth: on }, { fullWidth: on }, "Couldn't change the page width.")
            }
          >
            Full width
          </DropdownMenuCheckboxItem>
        )}
        {canEdit && (
          <DropdownMenuItem onSelect={() => setLocked(!locked)}>
            {locked ? <LockOpen aria-hidden /> : <Lock aria-hidden />}
            {locked ? 'Unlock page' : 'Lock page'}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => actions.copyLink(page.id)}>
          <Link2 aria-hidden />
          Copy link
        </DropdownMenuItem>
        {canManage && page.kind !== 'row' && (
          <DropdownMenuItem
            onSelect={() => {
              toDialog.current = true;
              actions.chooseMove(asTreeNode(page));
            }}
          >
            <CornerUpRight aria-hidden />
            Move to
          </DropdownMenuItem>
        )}
        {canManage && (
          <DropdownMenuItem variant="danger" onSelect={() => actions.trash(asTreeNode(page))}>
            <Trash2 aria-hidden />
            Move to Trash
          </DropdownMenuItem>
        )}
        {canManage && page.kind !== 'row' && (
          <DropdownMenuItem onSelect={() => setArchived(!archived)}>
            {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
            {archived ? 'Unarchive' : 'Archive'}
          </DropdownMenuItem>
        )}
        {more.map(({ id, label, icon: Icon, onSelect }) => (
          <DropdownMenuItem key={id} onSelect={() => onSelect(slotPage)}>
            {Icon && (
              <span aria-hidden className="flex">
                <Icon className="size-4" />
              </span>
            )}
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <PageInfo page={page} editor={editor} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Word and character counts, and who made and last edited the page; read as the menu opens. */
function PageInfo({ page, editor }: Omit<PageMenuProps, 'actions'>) {
  const lines = [
    page.kind !== 'database' && editor ? textCounts(editor.getText()) : null,
    page.created && madeWhen('Created', page.created),
    page.edited && madeWhen('Edited', page.edited),
  ].filter((line): line is string => Boolean(line));
  return (
    <div role="group" aria-label="Page info" className="flex flex-col gap-0.5 px-2 py-1.5">
      {lines.map((line) => (
        <span key={line} className="text-label text-muted">
          {line}
        </span>
      ))}
    </div>
  );
}
