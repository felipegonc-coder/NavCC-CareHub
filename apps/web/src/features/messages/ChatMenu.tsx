import { Bell, BellOff, Ellipsis, LogOut, Pencil, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { chatPermissions, type ChatJson, type PeopleJson } from '@carehub/team-chat';
import {
  buttonClasses,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@carehub/ui';
import { MESSAGES_PATH } from './chat-info';
import { useMute } from './data';
import { AddPeopleDialog, LeaveDialog, PeopleDialog, RenameDialog } from './GroupDialogs';

interface ChatMenuProps {
  chat: ChatJson;
  viewerId: string;
  title: string;
  people: PeopleJson;
  /** Mark as unread shows only when someone else has written. */
  canMarkUnread: boolean;
  onMarkUnread(): void;
}

type Open = 'rename' | 'add' | 'people' | 'leave' | null;

/** The chat's menu: Rename, Add people, People, Mute, Mark as unread and Leave. */
export function ChatMenu({
  chat,
  viewerId,
  title,
  people,
  canMarkUnread,
  onMarkUnread,
}: ChatMenuProps) {
  const [open, setOpen] = useState<Open>(null);
  const mute = useMute(chat.id);
  const navigate = useNavigate();
  const me = chat.members.find((member) => member.userId === viewerId);
  const can = chatPermissions({
    chatType: chat.type,
    member: me ? { canRemoveOthers: me.canRemoveOthers, leftAt: null } : null,
    isGuest: false,
  });
  const show = (which: Open) => (next: boolean) => setOpen(next ? which : null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Chat options"
          data-testid="messages-chat-menu"
          className={buttonClasses({ variant: 'ghost', size: 'sm', icon: true })}
        >
          <Ellipsis className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {can.rename && (
            <DropdownMenuItem onSelect={() => setOpen('rename')} data-testid="messages-rename">
              <Pencil className="size-4" aria-hidden />
              Rename
            </DropdownMenuItem>
          )}
          {can.addPeople && (
            <DropdownMenuItem onSelect={() => setOpen('add')} data-testid="messages-add-people">
              <UserPlus className="size-4" aria-hidden />
              Add people
            </DropdownMenuItem>
          )}
          {chat.type === 'group' && (
            <DropdownMenuItem onSelect={() => setOpen('people')} data-testid="messages-people">
              <Users className="size-4" aria-hidden />
              People
            </DropdownMenuItem>
          )}
          {can.mute && (
            <DropdownMenuItem onSelect={() => mute.mutate(!chat.muted)} data-testid="messages-mute">
              {chat.muted ? (
                <Bell className="size-4" aria-hidden />
              ) : (
                <BellOff className="size-4" aria-hidden />
              )}
              {chat.muted ? 'Unmute' : 'Mute'}
            </DropdownMenuItem>
          )}
          {canMarkUnread && (
            <DropdownMenuItem data-testid="messages-mark-unread" onSelect={onMarkUnread}>
              Mark as unread
            </DropdownMenuItem>
          )}
          {can.leave && (
            <DropdownMenuItem
              variant="danger"
              onSelect={() => setOpen('leave')}
              data-testid="messages-leave"
            >
              <LogOut className="size-4" aria-hidden />
              Leave
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {can.rename && (
        <RenameDialog chat={chat} open={open === 'rename'} onOpenChange={show('rename')} />
      )}
      {can.addPeople && (
        <AddPeopleDialog chat={chat} open={open === 'add'} onOpenChange={show('add')} />
      )}
      {chat.type === 'group' && (
        <PeopleDialog
          chat={chat}
          viewerId={viewerId}
          people={people}
          open={open === 'people'}
          onOpenChange={show('people')}
        />
      )}
      {can.leave && (
        <LeaveDialog
          chat={chat}
          viewerId={viewerId}
          title={title}
          open={open === 'leave'}
          onOpenChange={show('leave')}
          onLeft={() => {
            setOpen(null);
            void navigate(MESSAGES_PATH);
          }}
        />
      )}
    </>
  );
}
