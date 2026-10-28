import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
} from '@carehub/ui';
import { useId, useRef, useState } from 'react';
import { useRemoveAssignment } from './data';
import {
  byText,
  courseTitleOf,
  dueText,
  listText,
  titleOf,
  whoText,
  type AssignmentEntry,
  type Names,
} from './entries';

// The workspace's assignments, newest first, each with Remove (after a check).

export type AssignmentListProps = {
  entries: readonly AssignmentEntry[];
  names: Names;
  pathTitles: ReadonlyMap<string, string>;
  /** The profile's time zone: the day each assignment was made is shown in it. */
  timeZone: string;
  /** Says what happened, in the screen's status line. */
  onRemoved(message: string): void;
};

type Removing = { entry: AssignmentEntry; title: string; who: string };

const entryClasses = [
  'flex flex-col gap-1 rounded border border-border p-4',
  'md:flex-row md:items-start md:justify-between md:gap-4',
].join(' ');

export function AssignmentList({
  entries,
  names,
  pathTitles,
  timeZone,
  onRemoved,
}: AssignmentListProps) {
  const remove = useRemoveAssignment();
  const [removing, setRemoving] = useState<Removing | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  /** The Remove button that opened the dialog: the focus goes back to it on Cancel. */
  const opener = useRef<HTMLButtonElement | null>(null);
  const removed = useRef(false);

  async function confirm() {
    if (!removing || remove.isPending) return;
    try {
      await remove.mutateAsync(removing.entry.id);
      removed.current = true;
      setProblem(null);
      onRemoved(`Removed "${removing.title}".`);
      setRemoving(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Something went wrong. Try again.');
      setRemoving(null);
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} ref={heading} tabIndex={-1} className="text-h2 text-fg focus:outline-none">
        Assignments
      </h2>
      {problem && (
        <p role="alert" className="text-small text-danger">
          {problem}
        </p>
      )}
      {entries.length === 0 ? (
        <EmptyState message="Nothing is assigned yet." />
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => {
            const title = titleOf(entry, pathTitles);
            const who = whoText(entry, names);
            return (
              <li key={entry.id} className={entryClasses}>
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="text-body font-semibold text-fg">{title}</h3>
                  {entry.pathId !== null && (
                    <p className="text-small text-muted">
                      {`Learning path: ${listText(entry.rows.map(courseTitleOf))}`}
                    </p>
                  )}
                  <p className="text-small text-fg">{`For ${who}`}</p>
                  <p className="text-small text-muted">
                    {`${dueText(entry)} · ${entry.required ? 'Required' : 'Optional'}`}
                  </p>
                  <p className="text-small text-muted">{byText(entry, names.people, timeZone)}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2 self-start md:mt-0"
                  aria-label={`Remove ${title} for ${who}`}
                  onClick={(event) => {
                    opener.current = event.currentTarget;
                    setRemoving({ entry, title, who });
                  }}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        {removing && (
          <DialogContent
            onCloseAutoFocus={(event) => {
              // Back to the Remove button, or, when the entry is gone, to the list's heading.
              event.preventDefault();
              const target = removed.current ? heading.current : opener.current;
              removed.current = false;
              target?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>Remove this assignment?</DialogTitle>
              <DialogDescription>
                {`"${removing.title}" will no longer be assigned to ${removing.who}. ` +
                  "What they've done so far stays."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={remove.isPending} onClick={() => void confirm()}>
                Remove
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
