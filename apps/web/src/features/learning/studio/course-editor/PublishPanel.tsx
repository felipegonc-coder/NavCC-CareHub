import { LIMITS } from '@carehub/learning';
import type { Id, PublishNotify, PublishProblem } from '@carehub/learning';
import {
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Textarea,
} from '@carehub/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { JSX } from 'react';
import { RadioChoices } from '../choices';
import { useStudioClient } from '../context';
import type { SaveStatus } from '../data/autosave';
import { isStudioError, StudioError } from '../data/client';
import { studioKeys } from '../data/queries';

// What happens to people who already started (decision 0311).
const NOTIFY = [
  {
    value: 'none',
    label: "Don't tell them",
    description:
      'They carry on with the version they started. People who start from now get this one.',
  },
  {
    value: 'tell',
    label: 'Move them to this version and tell them',
    description:
      'People partway through carry on in this version with their progress and get an alert. Finished results stay.',
  },
  {
    value: 'retake',
    label: 'Ask everyone to take it again',
    description:
      'Everyone who started, finished or not, starts again on this version and gets a reminder.',
  },
] as const satisfies readonly { value: PublishNotify; label: string; description: string }[];

const NOT_SAVED: Partial<Record<SaveStatus, StudioError>> = {
  offline: new StudioError('offline', "You're offline. Publish once you're back online."),
  conflict: new StudioError(
    'conflict',
    'Someone else saved this course. Choose whose version to keep first.',
  ),
  error: new StudioError(
    'failed',
    "The latest changes couldn't be saved yet. Try again in a moment.",
  ),
};

/** Props for {@link ProblemsPanel}. */
export type ProblemsPanelProps = {
  /** What stops publishing, worked out again from the draft on every change. */
  problems: readonly PublishProblem[];
  /** Takes the author to the lesson, block or setting a problem is about. */
  onShow(problem: PublishProblem): void;
  onClose(): void;
};

/** What to fix before publishing, in plain words, each with a way to its place. Stays open while fixing. */
export function ProblemsPanel(props: ProblemsPanelProps): JSX.Element {
  const headingId = useId();
  const count = props.problems.length;
  return (
    <Card role="region" aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-body font-semibold text-fg">
          Before publishing
        </h2>
        <Button size="sm" variant="ghost" onClick={props.onClose}>
          Close
        </Button>
      </div>
      <p className="text-small text-fg">
        {count === 0
          ? "Nothing left to fix. Publish when you're ready."
          : count === 1
            ? 'Fix this before publishing:'
            : `Fix these ${count} things before publishing:`}
      </p>
      {count > 0 && (
        <ul className="flex flex-col gap-1">
          {props.problems.map((problem, index) => (
            <li key={`${problem.path}:${index}`} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-small text-fg">{problem.message}</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Show me: ${problem.message}`}
                onClick={() => props.onShow(problem)}
              >
                Show me
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Props for {@link PublishDialog}. */
export type PublishDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  courseId: Id;
  /** The live version number, or null before the first publish. */
  liveVersion: number | null;
  /** Saves what is waiting before publishing. */
  flush(): Promise<SaveStatus>;
  onPublished(version: number): void;
  /** The server found problems the editor didn't (it checks again on publish). */
  onRefused(problems: PublishProblem[]): void;
};

function PublishForm(props: Omit<PublishDialogProps, 'open' | 'onOpenChange'>) {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const [notify, setNotify] = useState<PublishNotify>('none');
  const [note, setNote] = useState('');
  const publish = useMutation({
    mutationFn: async () => {
      const unsaved = NOT_SAVED[await props.flush()];
      if (unsaved) throw unsaved;
      const text = note.trim();
      return client.publish(props.courseId, { notify, ...(text ? { note: text } : {}) });
    },
    onSuccess: ({ version }) => {
      void queryClient.invalidateQueries({ queryKey: studioKeys.courseLists });
      props.onPublished(version);
    },
    onError: (error) => {
      if (isStudioError(error, 'cannot_publish')) props.onRefused(error.problems);
    },
  });
  const first = props.liveVersion === null;
  const next = (props.liveVersion ?? 0) + 1;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        publish.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{first ? 'Publish this course' : `Publish version ${next}`}</DialogTitle>
        <DialogDescription>
          {first
            ? 'People with access can start it as soon as it is published.'
            : 'People who start from now get this version.'}
        </DialogDescription>
      </DialogHeader>
      {!first && (
        <RadioChoices<PublishNotify>
          legend="People who already started"
          value={notify}
          options={NOTIFY}
          onChange={setNotify}
        />
      )}
      <Field label="What changed" hint="Optional. Kept with the version.">
        <Textarea
          rows={2}
          value={note}
          maxLength={LIMITS.shortText}
          onChange={(event) => setNote(event.currentTarget.value)}
        />
      </Field>
      {publish.isError && !isStudioError(publish.error, 'cannot_publish') && (
        <p role="alert" className="text-small text-danger">
          {publish.error instanceof StudioError && publish.error.code !== 'failed'
            ? publish.error.message
            : "Publishing didn't work. Try again."}
        </p>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button type="submit" loading={publish.isPending}>
          {first ? 'Publish' : `Publish version ${next}`}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Publish, once nothing needs fixing: who hears about the new version (0311), an optional note, Publish. */
export function PublishDialog({ open, onOpenChange, ...props }: PublishDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <PublishForm {...props} />
      </DialogContent>
    </Dialog>
  );
}
