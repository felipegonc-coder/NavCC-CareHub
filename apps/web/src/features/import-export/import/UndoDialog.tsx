import type { ImportView, UndoPreview } from '@carehub/extras/import-export/import/index';
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Spinner,
} from '@carehub/ui';
import { useState } from 'react';
import { ApiError } from '../../../lib/api';
import { importsApi } from './client';

// Undo import (Import and export spec, section 3.1): everything the import made goes to Trash as
// one entry. Pages changed since then are listed first, and stay unless "Remove them too" is
// ticked.

const message = (failure: unknown) =>
  failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.';

export interface UndoDialogProps {
  view: ImportView;
  onUndone(view: ImportView): void;
}

export function UndoDialog({ view, onUndone }: UndoDialogProps) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<UndoPreview | null>(null);
  const [removeChanged, setRemoveChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setPreview(null);
    setRemoveChanged(false);
    setError(null);
    try {
      setPreview(await importsApi.undoPreview(view.id));
    } catch (failure) {
      setError(message(failure));
    }
  }

  async function undo() {
    setBusy(true);
    setError(null);
    try {
      onUndone(await importsApi.undo(view.id, removeChanged));
      setOpen(false);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  const changed = preview?.changed ?? [];
  return (
    <Dialog open={open} onOpenChange={(next) => void onOpenChange(next)}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          Undo import
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Undo import?</DialogTitle>
          <DialogDescription>
            Everything {view.fileName} added goes to Trash as one entry.
          </DialogDescription>
        </DialogHeader>
        {!preview && !error && <Spinner />}
        {changed.length > 0 && (
          <div className="flex flex-col gap-2 text-small">
            <p>These pages changed since the import. They stay unless you remove them too.</p>
            <ul className="flex max-h-48 list-disc flex-col gap-1 overflow-y-auto pl-5">
              {changed.map((page) => (
                <li key={page.pageId}>{page.title}</li>
              ))}
            </ul>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={removeChanged}
                onCheckedChange={(checked) => setRemoveChanged(checked === true)}
              />
              Remove them too
            </label>
          </div>
        )}
        {error && (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button variant="danger" loading={busy} disabled={!preview} onClick={() => void undo()}>
            Undo import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
