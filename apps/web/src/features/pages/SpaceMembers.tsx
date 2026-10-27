// A space's members and owners, people or groups, and who is asking to join (Sidebar spec,
// section 3.3), on its settings screen. A space always keeps an owner.
import {
  Avatar,
  Button,
  cn,
  Dialog,
  DialogContent,
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
  Skeleton,
  useToast,
  VisuallyHidden,
} from '@carehub/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Users, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../lib/api';
import {
  addSpaceMember,
  answerJoinRequest,
  fetchSpaceMembers,
  findCandidates,
  pagesKeys,
  removeSpaceMember,
  setSpaceRole,
  type Candidate,
  type JoinRequest,
  type SpaceMember,
  type SpaceMembers as Members,
  type SpaceRole,
} from './api';
import { reasonOf } from './change';
import { ago } from './trash';

const ROLE_LABELS: Record<SpaceRole, string> = { owner: 'Owner', member: 'Member' };
const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;

interface SpaceMembersProps {
  space: { id: string; name: string };
}

export function SpaceMembers({ space }: SpaceMembersProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = pagesKeys.members(space.id);
  const list = useQuery({ queryKey: key, queryFn: () => fetchSpaceMembers(space.id) });
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  /** Before a row goes, focus moves to the row after it (or before it), or else to Add members. */
  const keepFocus = (from: HTMLElement) => {
    const row = from.closest('li');
    const near = row?.nextElementSibling ?? row?.previousElementSibling;
    (near?.querySelector('button') ?? addButton.current)?.focus();
  };
  /** The settings, the members and, as one's own place can change, the sidebar and Browse spaces. */
  const refresh = () => {
    for (const queryKey of [pagesKeys.space(space.id), pagesKeys.spaces, pagesKeys.browse])
      void queryClient.invalidateQueries({ queryKey });
  };

  const needsOwner = () =>
    toast({
      title: `“${space.name}” needs an owner.`,
      description: 'Make someone else an owner first.',
      variant: 'danger',
    });
  /** Whether `member` is the space's only owner, so it can't stop being one. */
  const lastOwner = (member: SpaceMember) =>
    member.role === 'owner' &&
    !list.data?.members.some((other) => other.id !== member.id && other.role === 'owner');

  /**
   * Shows the change at once; if the server refuses, it goes back and a toast says why. A refusal
   * with 409 to a change of `owners` means it would have left the space without one.
   */
  const change = (
    shown: (members: Members) => Members,
    request: () => Promise<unknown>,
    done: string | null,
    failed: string,
    owners = false,
  ) => {
    const before = queryClient.getQueryData<Members>(key);
    if (before) queryClient.setQueryData(key, shown(before));
    void request()
      .then(
        () => {
          if (done) toast({ title: done, variant: 'success' });
        },
        (error: unknown) => {
          if (before) queryClient.setQueryData(key, before);
          if (owners && error instanceof ApiError && error.status === 409) needsOwner();
          else toast({ title: failed, description: reasonOf(error), variant: 'danger' });
        },
      )
      .finally(refresh);
  };
  const others = (members: Members, id: string) => members.members.filter((m) => m.id !== id);
  const setRole = (member: SpaceMember, role: SpaceRole) => {
    if (role === 'member' && lastOwner(member)) {
      needsOwner();
      return;
    }
    change(
      (members) => ({
        ...members,
        members: members.members.map((m) => (m.id === member.id ? { ...m, role } : m)),
      }),
      () => setSpaceRole(space.id, member.id, role),
      null,
      `Couldn't change ${member.name}'s role.`,
      true,
    );
  };
  const remove = (member: SpaceMember, from: HTMLElement) => {
    if (lastOwner(member)) {
      needsOwner();
      return;
    }
    keepFocus(from);
    change(
      (members) => ({ ...members, members: others(members, member.id) }),
      () => removeSpaceMember(space.id, member.id),
      `Removed ${member.name} from “${space.name}”.`,
      `Couldn't remove ${member.name}.`,
      true,
    );
  };
  const answer = (request: JoinRequest, approve: boolean, from: HTMLElement) => {
    keepFocus(from);
    change(
      (members) => ({
        ...members,
        requests: members.requests.filter((r) => r.id !== request.id),
      }),
      () => answerJoinRequest(space.id, request.id, approve),
      approve
        ? `${request.user.name} is in “${space.name}” now.`
        : `Declined ${request.user.name}'s request.`,
      "Couldn't answer the request.",
    );
  };

  if (list.isError) {
    return (
      <p className="flex items-center gap-2 text-muted">
        Couldn&apos;t load the members.
        <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
          Retry
        </Button>
      </p>
    );
  }
  if (!list.data) return <Loading />;
  const { members, requests } = list.data;
  return (
    <>
      {requests.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-small font-medium">Asking to join</h3>
          <ul aria-label="Asking to join" className="flex flex-col">
            {requests.map((request) => (
              <Row
                key={request.id}
                avatar={<Avatar name={request.user.name} src={request.user.avatarUrl} decorative />}
                name={request.user.name}
                about={[request.user.email, `Asked ${ago(request.requestedAt, Date.now())}`]}
              >
                <Button
                  size="sm"
                  aria-label={`Approve ${request.user.name}`}
                  onClick={(event) => answer(request, true, event.currentTarget)}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Decline ${request.user.name}`}
                  onClick={(event) => answer(request, false, event.currentTarget)}
                >
                  Decline
                </Button>
              </Row>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto text-small text-muted">
          {plural(members.length, 'member')}. Members get the default access on every page, unless a
          page has its own.
        </p>
        <Button ref={addButton} variant="secondary" onClick={() => setAdding(true)}>
          Add members
        </Button>
      </div>
      <ul aria-label="Members" className="flex flex-col">
        {members.map((member) => (
          <Row
            key={member.id}
            avatar={<MemberAvatar member={member} />}
            name={member.name}
            about={[member.type === 'group' ? 'Group' : member.email]}
          >
            <Select
              value={member.role}
              onValueChange={(role) => setRole(member, role as SpaceRole)}
            >
              <SelectTrigger aria-label={`Role of ${member.name}`} className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['owner', 'member'] as const).map((role) => (
                  <SelectItem key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <IconButton
              label={`Remove ${member.name}`}
              size="sm"
              onClick={(event) => remove(member, event.currentTarget)}
            >
              <X aria-hidden />
            </IconButton>
          </Row>
        ))}
      </ul>
      {adding && (
        <AddMembersDialog
          space={space}
          current={new Set(members.map((member) => member.id))}
          onAdded={refresh}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}

interface RowProps {
  avatar: ReactNode;
  name: string;
  about: readonly (string | undefined)[];
  children: ReactNode;
}

function Row({ avatar, name, about, children }: RowProps) {
  const details = about.filter(Boolean).join(' · ');
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2">
      {avatar}
      <span className="flex min-w-0 flex-1 basis-40 flex-col">
        <span className="truncate">{name}</span>
        {details && <span className="truncate text-small text-muted">{details}</span>}
      </span>
      <span className="flex items-center gap-2">{children}</span>
    </li>
  );
}

function MemberAvatar({
  member,
}: {
  member: { type: string; name: string; avatarUrl?: string | undefined };
}) {
  if (member.type !== 'group')
    return <Avatar name={member.name} src={member.avatarUrl} decorative />;
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-fill-hover text-muted">
      <Users aria-hidden className="size-4" />
    </span>
  );
}

/** The value, once it has stopped changing for a quarter of a second. */
function useSettled(value: string): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), 250);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}

interface AddMembersDialogProps {
  space: { id: string; name: string };
  /** Who is in the space already. */
  current: ReadonlySet<string>;
  onAdded(): void;
  onClose(): void;
}

/** Find people or groups by name or email and add each, as members or owners. */
function AddMembersDialog({ space, current, onAdded, onClose }: AddMembersDialogProps) {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<SpaceRole>('member');
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const settled = useSettled(query.trim());
  const found = useQuery({
    queryKey: pagesKeys.people(settled),
    queryFn: () => findCandidates(settled),
    enabled: settled !== '',
    staleTime: 30_000,
  });

  const add = (candidate: Candidate) => {
    const { id } = candidate;
    const settle = () => setBusy((ids) => new Set([...ids].filter((other) => other !== id)));
    setBusy((ids) => new Set(ids).add(id));
    void addSpaceMember(space.id, { type: candidate.type, id }, role).then(
      () => {
        settle();
        setAdded((ids) => new Set(ids).add(id));
        onAdded();
      },
      (error: unknown) => {
        settle();
        const title = `Couldn't add ${candidate.name}.`;
        toast({ title, description: reasonOf(error), variant: 'danger' });
      },
    );
  };

  let results: ReactNode;
  if (settled === '') {
    results = <p className="text-small text-muted">Type a name or an email.</p>;
  } else if (found.isError) {
    results = (
      <p className="flex items-center gap-2 text-small text-muted">
        Couldn&apos;t search.
        <Button variant="secondary" size="sm" onClick={() => void found.refetch()}>
          Retry
        </Button>
      </p>
    );
  } else if (!found.data) {
    results = <Loading />;
  } else if (found.data.length === 0) {
    results = <p className="text-small text-muted">Nobody matches “{settled}”.</p>;
  } else {
    results = (
      <ul aria-label="People and groups" className="flex max-h-80 flex-col overflow-y-auto">
        {found.data.map((candidate) => {
          // Someone just added keeps the same button, so focus stays on it.
          const done = added.has(candidate.id);
          const about =
            candidate.type === 'group'
              ? [
                  candidate.size === undefined
                    ? 'Group'
                    : `Group · ${plural(candidate.size, 'person')}`,
                ]
              : [candidate.email];
          return (
            <Row
              key={candidate.id}
              avatar={<MemberAvatar member={candidate} />}
              name={candidate.name}
              about={about}
            >
              {candidate.isGuest ? (
                <span className="text-small text-muted">Guests can&apos;t join spaces</span>
              ) : current.has(candidate.id) && !done ? (
                <span className="flex items-center gap-1 text-small text-muted">
                  <Check aria-hidden className="size-4" />
                  In the space
                </span>
              ) : (
                <Button
                  size="sm"
                  variant={done ? 'ghost' : 'secondary'}
                  loading={busy.has(candidate.id)}
                  aria-label={`${done ? 'Added' : 'Add'} ${candidate.name}`}
                  aria-disabled={done || busy.has(candidate.id) || undefined}
                  onClick={done ? undefined : () => add(candidate)}
                  className={cn(done && 'cursor-default text-muted hover:bg-transparent')}
                >
                  {done ? 'Added' : 'Add'}
                </Button>
              )}
            </Row>
          );
        })}
      </ul>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Add members to “{space.name}”</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Find people or groups" className="min-w-48 flex-1">
            <Input
              type="search"
              value={query}
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
            />
          </Field>
          <Field label="Add as">
            <Select value={role} onValueChange={(value) => setRole(value as SpaceRole)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['member', 'owner'] as const).map((choice) => (
                  <SelectItem key={choice} value={choice}>
                    {ROLE_LABELS[choice]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        {results}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Grey bars, only once loading has taken 300 ms. */
function Loading() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), 300);
    return () => clearTimeout(timer);
  }, []);
  if (!late) return null;
  return (
    <div className="flex flex-col gap-2">
      <VisuallyHidden role="status">Loading</VisuallyHidden>
      {['w-2/3', 'w-1/2'].map((width) => (
        <Skeleton key={width} className={`h-10 ${width}`} />
      ))}
    </div>
  );
}
