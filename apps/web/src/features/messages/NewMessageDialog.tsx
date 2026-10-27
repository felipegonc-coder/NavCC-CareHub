import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { GROUP_MAX_PEOPLE, GROUP_NAME_MAX_LENGTH, type PersonOptionJson } from '@carehub/team-chat';
import {
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
import { chatHref } from './chat-info';
import { useStartChat } from './data';
import { PeoplePicker, usePicked } from './PeoplePicker';

/** Pick people: one opens your direct chat with them, more start a group (or open the one you have). */
export function NewMessageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="messages-new-dialog">
        <NewMessageForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NewMessageForm({ onDone }: { onDone(): void }) {
  const start = useStartChat();
  const navigate = useNavigate();
  const nameId = useId();
  // You're in the group too: 50 people in all.
  const { picked, full, toggle: togglePicked } = usePicked(GROUP_MAX_PEOPLE - 1);
  const [name, setName] = useState('');
  const [existingId, setExistingId] = useState<string | null>(null);
  const group = picked.length > 1;

  const toggle = (person: PersonOptionJson) => {
    setExistingId(null);
    start.reset();
    togglePicked(person);
  };

  const openChat = (chatId: string) => {
    onDone();
    void navigate(chatHref(chatId));
  };

  const submit = (startNew: boolean) => {
    if (picked.length === 0) return;
    start.mutate(
      {
        userIds: picked.map((person) => person.id),
        name: group ? name.trim() || null : null,
        startNew,
      },
      {
        onSuccess: (answer) => {
          if (answer.existing && group && !startNew) setExistingId(answer.chatId);
          else openChat(answer.chatId);
        },
      },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>New message</DialogTitle>
        <DialogDescription>
          Pick one person for a direct chat, or more to start a group.
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit(false);
        }}
      >
        <PeoplePicker picked={picked} onToggle={toggle} full={full} />
        {group && (
          <div className="flex flex-col gap-1">
            <label htmlFor={nameId} className="text-label">
              Group name (optional)
            </label>
            <Input
              id={nameId}
              value={name}
              maxLength={GROUP_NAME_MAX_LENGTH}
              data-testid="messages-group-name"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        )}
        {start.error && (
          <p role="alert" className="text-small text-danger">
            {start.error.message}
          </p>
        )}
        {existingId ? (
          <>
            <p>You already have a group with these people.</p>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                loading={start.isPending}
                onClick={() => submit(true)}
              >
                Start new group
              </Button>
              <Button
                type="button"
                data-testid="messages-open-existing"
                onClick={() => openChat(existingId)}
              >
                Open existing chat
              </Button>
            </DialogFooter>
          </>
        ) : (
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={picked.length === 0}
              loading={start.isPending}
              data-testid="messages-start-chat"
            >
              {group ? 'Start group' : 'Open chat'}
            </Button>
          </DialogFooter>
        )}
      </form>
    </>
  );
}
