// Restore this version (section 3.2, HT-05): the confirm, then one change that everyone editing
// sees, with the note "Avery Lin restored a version from Oct 20, 3:00 PM." Anything typed in the
// meantime is in the version the server saves just before.
import {
  restoreNote,
  restoreQuestion,
  versionDate,
  type VersionSummary,
} from '@carehub/extras/history';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from '@carehub/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { ApiError } from '../../lib/api';
import { historyKeys, restoreVersion } from './api';
import { runRestore } from './store';

export interface RestoreDialogProps {
  pageId: string;
  version: VersionSummary;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** After the restore, so the page shows. */
  onRestored(): void;
}

export function RestoreDialog({
  pageId,
  version,
  open,
  onOpenChange,
  onRestored,
}: RestoreDialogProps) {
  const client = useQueryClient();
  const { toast } = useToast();
  const restoreRef = useRef<HTMLButtonElement>(null);
  const restore = useMutation({
    mutationFn: (target: VersionSummary) =>
      runRestore(pageId, () => restoreVersion(pageId, target.id)),
    onSuccess: ({ version: saved }, target) => {
      const from = versionDate(saved.restoredFrom ?? target.createdAt);
      toast({ title: restoreNote(saved.createdBy?.name ?? 'You', from) });
      onOpenChange(false);
      onRestored();
    },
    onError: (error) => {
      onOpenChange(false);
      toast({
        title: "Couldn't restore this version.",
        description: error instanceof ApiError ? error.message : 'Try again.',
        variant: 'danger',
      });
    },
    // A refusal can mean the page was locked or archived meanwhile; the list says so.
    onSettled: () => {
      void client.invalidateQueries({ queryKey: historyKeys.list(pageId) });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!restore.isPending) onOpenChange(next);
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          restoreRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Restore this version?</DialogTitle>
          <DialogDescription>{restoreQuestion(versionDate(version.createdAt))}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            ref={restoreRef}
            loading={restore.isPending}
            onClick={() => restore.mutate(version)}
          >
            Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
