// A space's "…" in the sidebar (Sidebar spec, section 3.3): Space settings, Move up and down in the
// person's order, then Leave, Archive and Delete, each after a confirm; and "Create space".
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  useToast,
} from '@carehub/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  LogOut,
  MoreHorizontal,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../../lib/api';
import { refreshPageData } from './actions';
import {
  archiveSpace,
  createSpace,
  deleteSpace,
  fetchPageCount,
  leaveSpace,
  pagesKeys,
  type NewSpace,
} from './api';
import { reasonOf } from './change';
import { ConfirmSpaceDialog, CreateSpaceDialog } from './SpaceDialogs';
import type { Space } from './types';

/** What the person is asked to confirm. */
export type SpaceAsk = 'leave' | 'archive' | 'delete';

const pages = (count: number) => (count === 1 ? '1 page' : `${count} pages`);

/** Moving the space in the person's order; each is missing where the space can't go that way. */
export interface SpaceMoves {
  up?: (() => void) | undefined;
  down?: (() => void) | undefined;
}

interface SpaceMenuProps {
  space: Space;
  moves?: SpaceMoves | undefined;
}

/**
 * Members may leave Open and Closed spaces; owners and Admins may change, archive or delete them.
 */
export function SpaceMenu({ space, moves = {} }: SpaceMenuProps) {
  const navigate = useNavigate();
  const [asking, setAsking] = useState<SpaceAsk | null>(null);
  // The confirm opens once the menu has closed, so focus comes back to "…" afterwards.
  const next = useRef<SpaceAsk | null>(null);
  const canLeave = space.kind === 'open' || space.kind === 'closed';
  const canManage = space.canManage === true;
  const canMove = moves.up !== undefined || moves.down !== undefined;
  if (!canLeave && !canManage && !canMove) return null;
  const ask = (what: SpaceAsk) => () => {
    next.current = what;
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`${space.name} options`} size="sm" className="size-6">
            <MoreHorizontal aria-hidden />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={() => {
            setAsking(next.current);
            next.current = null;
          }}
        >
          {canManage && (
            <DropdownMenuItem onSelect={() => void navigate(spaceSettingsUrl(space.id))}>
              <Settings aria-hidden />
              Space settings
            </DropdownMenuItem>
          )}
          {moves.up && (
            <DropdownMenuItem onSelect={moves.up}>
              <ArrowUp aria-hidden />
              Move up
            </DropdownMenuItem>
          )}
          {moves.down && (
            <DropdownMenuItem onSelect={moves.down}>
              <ArrowDown aria-hidden />
              Move down
            </DropdownMenuItem>
          )}
          {(canManage || canMove) && (canLeave || canManage) && <DropdownMenuSeparator />}
          {canLeave && (
            <DropdownMenuItem onSelect={ask('leave')}>
              <LogOut aria-hidden />
              Leave space
            </DropdownMenuItem>
          )}
          {canManage && (
            <DropdownMenuItem onSelect={ask('archive')}>
              <Archive aria-hidden />
              Archive space
            </DropdownMenuItem>
          )}
          {canManage && (
            <DropdownMenuItem variant="danger" onSelect={ask('delete')}>
              <Trash2 aria-hidden />
              Delete space
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {asking && <SpaceConfirm space={space} asking={asking} onClose={() => setAsking(null)} />}
    </>
  );
}

export const spaceSettingsUrl = (id: string) => `/spaces/${id}/settings`;

interface SpaceConfirmProps {
  space: Space;
  asking: SpaceAsk;
  onClose(): void;
  /** Once the server has done it, such as leaving the space's settings. */
  onDone?: (() => void) | undefined;
}

/** The confirm before leaving, archiving or deleting the space, which then does it. */
export function SpaceConfirm({ space, asking, onClose, onDone }: SpaceConfirmProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const leave = () => leaveSpace(space.id);
  /** Sends the change; a refused Leave usually means the person is the last owner (409). */
  const run = (request: () => Promise<unknown>, done: string, failed: string) => {
    onClose();
    request().then(
      () => {
        onDone?.();
        void refreshPageData(queryClient);
        toast({ title: done, variant: 'success' });
      },
      (error: unknown) => {
        const lastOwner = request === leave && error instanceof ApiError && error.status === 409;
        toast(
          lastOwner
            ? {
                title: `You're the last owner of “${space.name}”.`,
                description: 'Make someone else an owner first, then leave.',
                variant: 'danger',
              }
            : { title: failed, description: reasonOf(error), variant: 'danger' },
        );
      },
    );
  };

  if (asking === 'leave') {
    return (
      <ConfirmSpaceDialog
        title={`Leave “${space.name}”?`}
        action="Leave space"
        danger
        onDone={(ok) =>
          ok ? run(leave, `You left “${space.name}”.`, "Couldn't leave the space.") : onClose()
        }
      >
        <p>You&apos;ll lose access to its pages, unless they&apos;re shared with you.</p>
        <p>
          {space.kind === 'closed'
            ? "To come back, you'll need an owner's OK."
            : 'You can join again from Browse spaces.'}
        </p>
      </ConfirmSpaceDialog>
    );
  }
  if (asking === 'archive') {
    return (
      <ConfirmSpaceDialog
        title={`Archive “${space.name}”?`}
        action="Archive space"
        onDone={(ok) =>
          ok
            ? run(
                () => archiveSpace(space.id),
                `Archived “${space.name}”.`,
                "Couldn't archive the space.",
              )
            : onClose()
        }
      >
        <p>
          It leaves everyone&apos;s sidebar and Browse spaces. Its pages keep their links but turn
          read-only.
        </p>
        <p>Admins can unarchive it in Settings → Spaces.</p>
      </ConfirmSpaceDialog>
    );
  }
  return (
    <DeleteSpaceDialog
      space={space}
      onDone={(ok) =>
        ok
          ? run(
              () => deleteSpace(space.id),
              `Moved “${space.name}” to Trash.`,
              "Couldn't delete the space.",
            )
          : onClose()
      }
    />
  );
}

/** Says how many pages go to Trash with the space, once the server has said. */
function DeleteSpaceDialog({ space, onDone }: { space: Space; onDone(ok: boolean): void }) {
  const count = useQuery({
    queryKey: [...pagesKeys.space(space.id), 'pageCount'],
    queryFn: () => fetchPageCount(space.id),
  }).data;
  return (
    <ConfirmSpaceDialog
      title={`Delete “${space.name}”?`}
      action="Delete space"
      danger
      onDone={onDone}
    >
      <p>
        {typeof count === 'number'
          ? `The space and its ${pages(count)} move to Trash.`
          : 'The space and all its pages move to Trash.'}
      </p>
      <p>Its members lose access to them until it&apos;s restored.</p>
    </ConfirmSpaceDialog>
  );
}

/** "+" next to Spaces, or a button with its name, as on Browse spaces. */
export function CreateSpaceButton({ named = false }: { named?: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const create = async (space: NewSpace) => {
    await createSpace(space);
    void refreshPageData(queryClient);
    toast({ title: `Created “${space.name}”.`, variant: 'success' });
  };
  return (
    <>
      {named ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Plus aria-hidden />
          Create space
        </Button>
      ) : (
        <IconButton label="Create space" size="sm" className="size-6" onClick={() => setOpen(true)}>
          <Plus aria-hidden />
        </IconButton>
      )}
      {open && <CreateSpaceDialog onCreate={create} onClose={() => setOpen(false)} />}
    </>
  );
}
