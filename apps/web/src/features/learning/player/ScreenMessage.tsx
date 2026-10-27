import { Button, buttonClasses, Spinner } from '@carehub/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { LearningApiError } from '../data';

// Whole-screen states for the learner's screens: loading, a message, and why a course didn't load.

type ScreenMessageProps = { title: string; text: string; children?: ReactNode };

/** A screen that only says something: its title, a heading, a sentence and what to do next. */
export function ScreenMessage({ title, text, children }: ScreenMessageProps) {
  return (
    <main className="mx-auto flex w-full max-w-page flex-col items-start gap-4 px-6 py-16">
      <title>{`Care Hub · ${title}`}</title>
      <h1 className="text-title text-fg">{title}</h1>
      <p className="text-body text-muted">{text}</p>
      {children}
    </main>
  );
}

/** While a screen's data loads: a spinner, with a heading and a title for screen readers. */
export function ScreenLoading({ label }: { label: string }) {
  return (
    <main aria-busy="true" className="mx-auto flex w-full max-w-page flex-col gap-4 px-6 py-16">
      <title>{`Care Hub · ${label}`}</title>
      <h1 className="sr-only">{label}</h1>
      <Spinner label={label} />
    </main>
  );
}

export function MyLearningLink() {
  return (
    <Link
      to="/learning"
      className={buttonClasses({ variant: 'secondary', className: 'max-md:h-11' })}
    >
      Go to My learning
    </Link>
  );
}

/** A course that doesn't exist, was never published, or a link with a bad course id. */
export function CourseNotFound() {
  return (
    <ScreenMessage
      title="Course not found"
      text="Check the link, or find the course in My learning."
    >
      <MyLearningLink />
    </ScreenMessage>
  );
}

type LoadFailedProps = {
  error: unknown;
  /** What didn't load, for the heading: "course", "lesson". */
  what: string;
  retry(): void;
};

/**
 * Why a learner's screen didn't load. Guests get a 403 from every Learning call; a course that was
 * never published (or doesn't exist) is a 404. Anything else can be tried again.
 */
export function LoadFailed({ error, what, retry }: LoadFailedProps) {
  const status = error instanceof LearningApiError ? error.status : null;
  if (status === 403) {
    return (
      <ScreenMessage
        title="No access to courses"
        text="Courses aren't available for guest accounts yet."
      />
    );
  }
  if (status === 404) return <CourseNotFound />;
  return (
    <ScreenMessage
      title={`This ${what} didn't load`}
      text={error instanceof LearningApiError ? error.message : 'Reload the page, then try again.'}
    >
      <Button onClick={retry} className="max-md:h-11">
        Try again
      </Button>
    </ScreenMessage>
  );
}
