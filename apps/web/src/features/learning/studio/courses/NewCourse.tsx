import { COURSE_TYPES } from '@carehub/learning';
import { Button, Card } from '@carehub/ui';
import { useId } from 'react';
import { useNavigate } from 'react-router';
import { useCreateCourse, useStudioExamples } from '../data/queries';
import type { NewCourseInput } from '../data/queries';
import { COURSE_TYPE_INFO, editorPath } from '../labels';

const choiceClasses =
  'flex h-full w-full flex-col gap-1 rounded border border-border bg-bg p-3 text-left hover:border-border-hover hover:bg-fill-hover disabled:text-faint';

/** New course: pick a course type (with its preset settings) or copy an example, then edit it. */
export function NewCourse({ onClose }: { onClose(): void }) {
  const headingId = useId();
  const navigate = useNavigate();
  const create = useCreateCourse();
  const examples = useStudioExamples();
  const start = (input: NewCourseInput) =>
    create.mutate(input, { onSuccess: (draft) => void navigate(editorPath(draft.course.id)) });

  return (
    <Card role="region" aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-body font-semibold text-fg">
          New course
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <section className="flex flex-col gap-2">
        <h3 className="text-small font-medium text-muted">Start from a course type</h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {COURSE_TYPES.map((type) => (
            <li key={type}>
              <button
                type="button"
                className={choiceClasses}
                disabled={create.isPending}
                onClick={() => start({ type })}
              >
                <span className="text-small font-semibold text-fg">
                  {COURSE_TYPE_INFO[type].label}
                </span>
                <span className="text-small text-muted">{COURSE_TYPE_INFO[type].description}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {examples.data && examples.data.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-small font-medium text-muted">Or copy an example course</h3>
          <ul className="flex flex-col gap-2">
            {examples.data.map((example) => (
              <li key={example.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-small font-semibold text-fg">{example.title}</p>
                  <p className="text-small text-muted">{example.summary}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Copy ${example.title}`}
                  disabled={create.isPending}
                  onClick={() => start({ type: example.type, exampleId: example.id })}
                >
                  Copy
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {create.isError && (
        <p role="alert" className="text-small text-danger">
          The course couldn't be created. Try again.
        </p>
      )}
    </Card>
  );
}
