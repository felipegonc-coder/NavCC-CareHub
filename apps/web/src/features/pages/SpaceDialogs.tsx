// Making a team space, and the confirms before leaving, archiving or deleting one (Sidebar spec,
// section 3.3).
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  IconButton,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@carehub/ui';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../../lib/api';
import { SPACE_NAME_MAX, type NewSpace } from './api';
import { reasonOf } from './change';
import { IconPicker } from './IconPicker';
import { EntryIcon } from './PageTree';
import type { PageIcon, SpaceAccess, SpaceKind } from './types';

export const SPACE_KINDS: readonly { value: SpaceKind; label: string; about: string }[] = [
  { value: 'open', label: 'Open', about: 'Everyone in the workspace can find it and join.' },
  {
    value: 'closed',
    label: 'Closed',
    about: 'Everyone can see its name and description. Owners approve who joins.',
  },
  {
    value: 'private',
    label: 'Private',
    about: 'Only its members know it exists. Owners add people.',
  },
];

export const ACCESS_LABELS: Record<SpaceAccess, string> = {
  full: 'Full access',
  edit: 'Can edit',
  comment: 'Can comment',
  view: 'Can view',
};

interface CreateSpaceDialogProps {
  /** Sends the space; rejects with the server's reason. */
  onCreate(space: NewSpace): Promise<unknown>;
  onClose(): void;
}

/** "+" next to Spaces: name, icon, description, kind and what members get. */
export function CreateSpaceDialog({ onCreate, onClose }: CreateSpaceDialogProps) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<PageIcon | null>(null);
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<SpaceKind>('open');
  const [access, setAccess] = useState<SpaceAccess>('edit');
  const [nameError, setNameError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) {
      setNameError('Give the space a name.');
      return;
    }
    setBusy(true);
    setProblem(null);
    const space = {
      name: clean,
      icon,
      description: description.trim(),
      kind,
      defaultAccess: access,
    };
    onCreate(space).then(onClose, (error: unknown) => {
      setBusy(false);
      if (error instanceof ApiError && error.status === 409) {
        setNameError(`There's already a space called “${clean}”.`);
      } else if (error instanceof ApiError && error.status === 403) {
        setProblem("You can't create spaces in this workspace. An Admin can change that.");
      } else {
        setProblem(reasonOf(error) ?? "Couldn't create the space. Try again.");
      }
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={(event: Event) => {
          event.preventDefault();
          nameField.current?.focus();
        }}
      >
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create a space</DialogTitle>
          </DialogHeader>
          <div className="flex items-start gap-2">
            <IconPicker icon={icon} onChange={setIcon}>
              <IconButton label="Space icon" variant="secondary" className="mt-6">
                <EntryIcon icon={icon} kind="space" />
              </IconButton>
            </IconPicker>
            <Field label="Name" error={nameError} required className="flex-1">
              <Input
                value={name}
                maxLength={SPACE_NAME_MAX}
                autoComplete="off"
                ref={nameField}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameError(null);
                }}
              />
            </Field>
          </div>
          <Field label="Description" hint="Shown in Browse spaces, so people know what it's for.">
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <KindChoices value={kind} onChange={setKind} />
          <Field
            label="Default access for members"
            hint="On every page in the space, unless a page has its own access."
          >
            <Select value={access} onValueChange={(value) => setAccess(value as SpaceAccess)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['full', 'edit', 'comment', 'view'] as const).map((level) => (
                  <SelectItem key={level} value={level}>
                    {ACCESS_LABELS[level]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {problem && (
            <p role="alert" className="text-small text-danger">
              {problem}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
              Create space
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface KindChoicesProps {
  value: SpaceKind;
  onChange(kind: SpaceKind): void;
}

/** Open, Closed or Private, each with what it means. */
export function KindChoices({ value, onChange }: KindChoicesProps) {
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-small font-medium text-fg">Who can find it</legend>
      {SPACE_KINDS.map((kind) => (
        <label
          key={kind.value}
          className={cn(
            'flex cursor-pointer items-start gap-2 rounded border p-3 hover:bg-fill-hover',
            kind.value === value ? 'border-primary bg-fill' : 'border-border',
          )}
        >
          <input
            type="radio"
            name={id}
            value={kind.value}
            checked={kind.value === value}
            aria-labelledby={`${id}-${kind.value}`}
            aria-describedby={`${id}-${kind.value}-about`}
            onChange={() => onChange(kind.value)}
            className="mt-1 accent-primary"
          />
          <span className="flex flex-col gap-0.5">
            <span id={`${id}-${kind.value}`} className="text-small font-medium text-fg">
              {kind.label}
            </span>
            <span id={`${id}-${kind.value}-about`} className="text-small text-muted">
              {kind.about}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

interface ConfirmSpaceDialogProps {
  title: string;
  children: ReactNode;
  /** The button that goes ahead, such as "Leave space". */
  action: string;
  danger?: boolean;
  onDone(ok: boolean): void;
}

/** Asks before leaving, archiving or deleting a space. */
export function ConfirmSpaceDialog({
  title,
  children,
  action,
  danger = false,
  onDone,
}: ConfirmSpaceDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent role="alertdialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-col gap-2">{children}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onDone(false)}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => onDone(true)}>
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
