// Name this version (section 3.1): a named version is kept forever, whatever the Data settings
// period, up to 100 per page. The name can be changed or removed.
import { VERSION_NAME_MAX_LENGTH, type VersionSummary } from '@carehub/extras/history';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  useToast,
} from '@carehub/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { historyKeys, nameVersion } from './api';

export interface NameDialogProps {
  pageId: string;
  version: VersionSummary;
  /** Closes the dialog, after saving or on Cancel. */
  onDone(): void;
}

export function NameDialog({ pageId, version, onDone }: NameDialogProps) {
  const client = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(version.name ?? '');
  const save = useMutation({
    mutationFn: (value: string | null) => nameVersion(pageId, version.id, value),
    onSuccess: ({ version: saved }) => {
      toast({ title: saved.name ? 'Version named' : 'Name removed' });
      onDone();
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: historyKeys.list(pageId) });
    },
  });
  // 409 when the page has 100 named versions; the server's words say what to do.
  const error = save.error
    ? save.error instanceof ApiError
      ? save.error.message
      : "Couldn't save the name. Try again."
    : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(name.trim() || null);
          }}
        >
          <DialogHeader>
            <DialogTitle>{version.name ? 'Rename this version' : 'Name this version'}</DialogTitle>
            <DialogDescription>Named versions are kept forever.</DialogDescription>
          </DialogHeader>
          <Field label="Name" required error={error}>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={VERSION_NAME_MAX_LENGTH}
              placeholder="Before the Nov policy change"
              autoComplete="off"
              required
            />
          </Field>
          <DialogFooter>
            {version.name && (
              <Button
                type="button"
                variant="ghost"
                disabled={save.isPending}
                onClick={() => save.mutate(null)}
              >
                Remove name
              </Button>
            )}
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
