import {
  buttonClasses,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@carehub/ui';
import { useMemo, useState, type ReactNode } from 'react';
import type { MoveHost } from './actions';
import type { AccessChange } from './api';
import { titleOf } from './PageTree';
import type { TreeNode } from './types';

interface Asking {
  page: TreeNode;
  change: AccessChange;
  resolve(ok: boolean): void;
}

/**
 * The dialogs a screen that moves pages shows: pass `host` to `useEntryActions` and render
 * `dialogs`.
 */
export function useMoveDialogs() {
  const [asking, setAsking] = useState<Asking | null>(null);
  const host = useMemo<MoveHost>(
    () => ({
      confirmMove: (page, change) =>
        new Promise<boolean>((resolve) => setAsking({ page, change, resolve })),
    }),
    [],
  );
  const dialogs: ReactNode = asking && (
    <AccessChangeDialog
      page={asking.page}
      change={asking.change}
      onDone={(ok) => {
        setAsking(null);
        asking.resolve(ok);
      }}
    />
  );
  return { host, dialogs };
}

interface AccessChangeDialogProps {
  page: TreeNode;
  change: AccessChange;
  onDone(ok: boolean): void;
}

/** Shown before a move that changes who can open the page (Roles and permissions). */
function AccessChangeDialog({ page, change, onDone }: AccessChangeDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change who can open “{titleOf(page)}”?</DialogTitle>
          <DialogDescription>
            In its new place, the page and its sub-pages take that place’s access.
          </DialogDescription>
        </DialogHeader>
        <People label="Will lose access" names={change.losing} />
        <People label="Will get access" names={change.gaining} />
        <DialogFooter>
          <button
            type="button"
            className={buttonClasses({ variant: 'secondary' })}
            onClick={() => onDone(false)}
          >
            Cancel
          </button>
          <button type="button" className={buttonClasses()} onClick={() => onDone(true)}>
            Move
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function People({ label, names }: { label: string; names: readonly string[] }) {
  if (names.length === 0) return null;
  const shown = names.slice(0, 5);
  const more = names.length - shown.length;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-label font-medium text-muted">{label}</h3>
      <p className="text-small">
        {shown.join(', ')}
        {more > 0 && ` and ${more} more`}
      </p>
    </div>
  );
}
