import { Avatar, VisuallyHidden } from '@carehub/ui';
import type { Person } from './presence';

export interface PresenceStackProps {
  /** `people` from `useCollabPage`. */
  people: Person[];
  /** Pictures shown before "+3" (default 5). */
  max?: number;
}

/** The people here now, for the top bar: their pictures, ringed in their caret color. */
export function PresenceStack({ people, max = 5 }: PresenceStackProps) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const rest = people.slice(max);
  return (
    <ul aria-label="People here now" className="flex items-center -space-x-1">
      {shown.map((person) => (
        <li
          key={person.id}
          title={person.fullName}
          className="rounded-full"
          style={{ boxShadow: `0 0 0 2px rgb(var(--ch-${person.color}-text))` }}
        >
          <Avatar name={person.fullName} src={person.avatarUrl ?? undefined} size="sm" />
        </li>
      ))}
      {rest.length > 0 && (
        <li
          title={rest.map((person) => person.fullName).join(', ')}
          className="pl-2 text-label text-muted"
        >
          <span aria-hidden="true">+{rest.length}</span>
          <VisuallyHidden>{`and ${rest.length} more`}</VisuallyHidden>
        </li>
      )}
    </ul>
  );
}
