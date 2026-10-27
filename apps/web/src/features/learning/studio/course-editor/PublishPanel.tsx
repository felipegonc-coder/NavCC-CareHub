import { checkPublishable, LIMITS } from '@carehub/learning';
import type { Course, Id, PublishProblem } from '@carehub/learning';
import { Button, Card, Field, Textarea } from '@carehub/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { JSX } from 'react';
import { useStudioClient } from '../context';
import type { SaveStatus } from '../data/autosave';
import { isStudioError, StudioError } from '../data/client';
import type { PublishNotify } from '../data/client';
import { studioKeys } from '../data/queries';
import { ChoiceButtons } from '../fields';

// What happens to people who already started (decision 0311).
const NOTIFY = [
  { value: 'none', label: 'Stay on their version' },
  { value: 'tell', label: 'Move to this one' },
  { value: 'retake', label: 'Start again' },
] as const satisfies readonly { value: PublishNotify; label: string }[];

const NOTIFY_NOTES: Record<PublishNotify, string> = {
  none: 'Nobody moves or hears about it. People who start from now get this version.',
  tell: 'People partway through move to this version with their progress and get an alert. People who finished keep their result.',
  retake:
    'Everyone who started, finished or not, begins again on this version and gets a reminder.',
};

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

/** Props for {@link PublishPanel}. */
export type PublishPanelProps = {
  courseId: Id;
  /** The draft as it is in the editor. */
  course: Course;
  /** The live version number, or null before the first publish. */
  liveVersion: number | null;
  /** Saves what is waiting before publishing. */
  flush(): Promise<SaveStatus>;
  onPublished(version: number): void;
  /** Takes the author to the lesson, block or setting a problem is about. */
  onShow(problem: PublishProblem): void;
  onClose(): void;
};

/**
 * Publish: what still needs fixing, in plain words with a way to each place; otherwise who hears about the new
 * version, an optional note and Publish.
 */
export function PublishPanel(props: PublishPanelProps): JSX.Element {
  const headingId = useId();
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const [notify, setNotify] = useState<PublishNotify>('none');
  const [note, setNote] = useState('');
  const publish = useMutation({
    mutationFn: async () => {
      const status = await props.flush();
      const unsaved = NOT_SAVED[status];
      if (unsaved) throw unsaved;
      const text = note.trim();
      return client.publish(props.courseId, { notify, ...(text ? { note: text } : {}) });
    },
    onSuccess: ({ version }) => {
      void queryClient.invalidateQueries({ queryKey: studioKeys.courseLists });
      props.onPublished(version);
    },
  });
  const local = checkPublishable(props.course);
  const refused = isStudioError(publish.error, 'publish_problems') ? publish.error.problems : [];
  const problems = local.length > 0 ? local : refused;
  const next = (props.liveVersion ?? 0) + 1;

  return (
    <Card role="region" aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-body font-semibold text-fg">
          Publish
        </h2>
        <Button size="sm" variant="ghost" onClick={props.onClose}>
          Close
        </Button>
      </div>
      {problems.length > 0 ? (
        <>
          <p className="text-small text-fg">
            {problems.length === 1
              ? 'Fix this before publishing:'
              : `Fix these ${problems.length} things before publishing:`}
          </p>
          <ul className="flex flex-col gap-1">
            {problems.map((problem, index) => (
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
        </>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            publish.mutate();
          }}
        >
          {props.liveVersion !== null && (
            <>
              <ChoiceButtons<PublishNotify>
                label="People who already started"
                value={notify}
                options={NOTIFY}
                onChange={setNotify}
              />
              <p className="text-small text-muted">{NOTIFY_NOTES[notify]}</p>
            </>
          )}
          <Field label="What changed" hint="Optional. Kept with the version.">
            <Textarea
              rows={2}
              value={note}
              maxLength={LIMITS.shortText}
              onChange={(event) => setNote(event.currentTarget.value)}
            />
          </Field>
          <Button type="submit" className="self-start" loading={publish.isPending}>
            {props.liveVersion === null ? 'Publish' : `Publish version ${next}`}
          </Button>
        </form>
      )}
      {publish.isError && refused.length === 0 && (
        <p role="alert" className="text-small text-danger">
          {publish.error instanceof StudioError && publish.error.code !== 'failed'
            ? publish.error.message
            : "Publishing didn't work. Try again."}
        </p>
      )}
    </Card>
  );
}
