import { useId, useMemo, useState } from 'react';
import {
  GROUP_MAX_PEOPLE,
  GROUP_NAME_MAX_LENGTH,
  personName,
  type ChatJson,
  type PeopleJson,
} from '@carehub/team-chat';
import {
  Avatar,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@carehub/ui';
import { useAddPeople, useLeaveChat, useRemovePerson, useRenameChat } from './data';
import { PeoplePicker, usePicked } from './PeoplePicker';

interface DialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

function ErrorLine({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-small text-danger">
      {error.message}
    </p>
  );
}

function CancelButton() {
  return (
    <DialogClose asChild>
      <Button type="button" variant="secondary">
        Cancel
      </Button>
    </DialogClose>
  );
}

/** Anyone in a group can rename it; a blank name shows the members' names. */
export function RenameDialog({ chat, open, onOpenChange }: DialogProps & { chat: ChatJson }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="messages-rename-dialog">
        <RenameForm chat={chat} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({ chat, onDone }: { chat: ChatJson; onDone(): void }) {
  const rename = useRenameChat(chat.id);
  const [name, setName] = useState(chat.name ?? '');
  const nameId = useId();
  const submit = () => {
    const next = name.trim() || null;
    if (next === chat.name) onDone();
    else rename.mutate(next, { onSuccess: onDone });
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename group</DialogTitle>
        <DialogDescription>Leave it blank to show the members' names.</DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={nameId} className="text-label">
            Group name
          </label>
          <Input
            id={nameId}
            value={name}
            maxLength={GROUP_NAME_MAX_LENGTH}
            autoComplete="off"
            data-testid="messages-rename-input"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <ErrorLine error={rename.error} />
        <DialogFooter>
          <CancelButton />
          <Button type="submit" loading={rename.isPending} data-testid="messages-rename-save">
            Save
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/** Add people to a group, up to 50 in all. They see its earlier messages. */
export function AddPeopleDialog({ chat, open, onOpenChange }: DialogProps & { chat: ChatJson }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="messages-add-people-dialog">
        <AddPeopleForm chat={chat} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddPeopleForm({ chat, onDone }: { chat: ChatJson; onDone(): void }) {
  const add = useAddPeople(chat.id);
  const room = Math.max(0, GROUP_MAX_PEOPLE - chat.members.length);
  const { picked, full, toggle } = usePicked(room);
  const memberIds = useMemo(
    () => new Set(chat.members.map((member) => member.userId)),
    [chat.members],
  );
  const submit = () => {
    if (picked.length === 0) return;
    add.mutate(
      picked.map((person) => person.id),
      { onSuccess: onDone },
    );
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add people</DialogTitle>
        <DialogDescription>They'll see earlier messages.</DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {room === 0 ? (
          <p className="text-muted">This group has 50 people, the most a group can have.</p>
        ) : (
          <PeoplePicker
            picked={picked}
            onToggle={(person) => {
              add.reset();
              toggle(person);
            }}
            full={full}
            hiddenIds={memberIds}
          />
        )}
        <ErrorLine error={add.error} />
        <DialogFooter>
          <CancelButton />
          <Button
            type="submit"
            disabled={picked.length === 0}
            loading={add.isPending}
            data-testid="messages-add-people-save"
          >
            Add
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

interface PeopleDialogProps extends DialogProps {
  chat: ChatJson;
  viewerId: string;
  people: PeopleJson;
}

/** Who's in a group, longest-standing first; whoever started it (or took over) can remove people. */
export function PeopleDialog({ chat, viewerId, people, open, onOpenChange }: PeopleDialogProps) {
  const remove = useRemovePerson(chat.id);
  const remover = chat.members.find((member) => member.canRemoveOthers);
  const canRemove = remover?.userId === viewerId;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) remove.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent data-testid="messages-people-dialog">
        <DialogHeader>
          <DialogTitle>People in this group</DialogTitle>
          <DialogDescription>
            {canRemove
              ? 'You can remove people from this group.'
              : remover
                ? `${personName(people[remover.userId])} can remove people from this group.`
                : 'Anyone here can add people.'}
          </DialogDescription>
        </DialogHeader>
        <ul
          aria-label="People in this group"
          className="flex max-h-80 flex-col gap-1 overflow-y-auto"
        >
          {chat.members.map((member) => {
            const name = personName(people[member.userId]);
            const you = member.userId === viewerId;
            return (
              <li
                key={member.userId}
                className="flex items-center gap-3 rounded px-2 py-1"
                data-testid="messages-member"
              >
                <Avatar name={name} size="sm" decorative />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">
                    {name}
                    {you && <span className="text-muted"> (you)</span>}
                  </span>
                  {member.canRemoveOthers && (
                    <span className="text-small text-muted">Can remove people</span>
                  )}
                </span>
                {canRemove && !you && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${name}`}
                    loading={remove.isPending && remove.variables === member.userId}
                    onClick={() => remove.mutate(member.userId)}
                  >
                    Remove
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <ErrorLine error={remove.error} />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface LeaveDialogProps extends DialogProps {
  chat: ChatJson;
  viewerId: string;
  title: string;
  onLeft(): void;
}

/** Anyone can leave a group; someone still in it can add them back. */
export function LeaveDialog({
  chat,
  viewerId,
  title,
  open,
  onOpenChange,
  onLeft,
}: LeaveDialogProps) {
  const leave = useLeaveChat(chat.id, viewerId);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) leave.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent data-testid="messages-leave-dialog">
        <DialogHeader>
          <DialogTitle>Leave {title}?</DialogTitle>
          <DialogDescription>
            You'll stop getting its messages. Someone in the group can add you back.
          </DialogDescription>
        </DialogHeader>
        <ErrorLine error={leave.error} />
        <DialogFooter>
          <CancelButton />
          <Button
            type="button"
            variant="danger"
            loading={leave.isPending}
            data-testid="messages-leave-confirm"
            onClick={() => leave.mutate(undefined, { onSuccess: onLeft })}
          >
            Leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
