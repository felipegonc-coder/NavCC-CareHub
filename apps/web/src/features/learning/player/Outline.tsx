import type { CourseOutline, OutlineLessonStatus } from '@carehub/learning';
import { cn, VisuallyHidden } from '@carehub/ui';
import { Circle, CircleCheck, CircleDot, Lock, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';

const STATUS_ICONS: Record<OutlineLessonStatus, LucideIcon> = {
  completed: CircleCheck,
  in_progress: CircleDot,
  not_started: Circle,
  locked: Lock,
};

type OutlineProps = {
  outline: CourseOutline;
  /** Called when the learner picks a lesson, so the phone menu can close. */
  onPick?: () => void;
};

/** The course's lessons in order with their state. The open lesson is the current page. */
export function Outline({ outline, onPick }: OutlineProps) {
  return (
    <div className="flex flex-col gap-2 p-3">
      <p className="px-3 text-small text-muted">
        {outline.completed} of {outline.total} lessons completed
      </p>
      <ol className="flex flex-col gap-1">
        {outline.rows.map((row) => {
          const Icon = STATUS_ICONS[row.status];
          return (
            <li key={row.lessonId}>
              <Link
                to={row.href}
                onClick={onPick}
                aria-current={row.current ? 'page' : undefined}
                title={row.lockedReason}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded px-3 py-2 text-small text-fg',
                  'hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-2',
                  'focus-visible:ring-ring',
                  row.current && 'bg-fill font-medium',
                  row.status === 'locked' && 'text-muted',
                )}
              >
                <Icon
                  aria-hidden
                  className={cn(
                    'size-4 shrink-0',
                    row.status === 'completed' ? 'text-success' : 'text-muted',
                  )}
                />
                <span className="min-w-0 flex-1 break-words">
                  {row.number}. {row.title}
                  <VisuallyHidden>, {row.statusText}</VisuallyHidden>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
