import {
  linkTarget,
  richTextLength,
  type Course,
  type Link,
  type RichText,
  type TextRun,
} from '@carehub/learning';
import { cn, VisuallyHidden } from '@carehub/ui';
import { Fragment, type MouseEvent, type ReactNode } from 'react';

type LinkCourse = Pick<Course, 'id' | 'lessons'>;

export interface RichTextViewProps {
  /** Paragraphs of text runs; "\n" inside a run is a line break. Without any text nothing shows. */
  value: RichText | undefined;
  /** The course the text belongs to, so links to its lessons and blocks can be followed. */
  course: LinkCourse;
  /** Opens a lesson (and block) of this course or a Care Hub page inside the app. */
  go(link: Link): void;
  /** Classes for the wrapping `div`, such as a text size or colour token. */
  className?: string;
}

const linkClasses = 'underline decoration-muted underline-offset-2 hover:decoration-fg';

/**
 * The read-only view of rich text (decision 0306): lesson text, feedback, transcripts, accordion
 * and tab bodies. Text takes the size and colour of its container; without any text it renders
 * nothing. It renders paragraphs, so put it in a `div`, not a `p`. Links go where the player's
 * `linkTarget` says: https links open in a new tab, lessons and Care Hub pages through `go`, and
 * a broken link stays plain text that says why.
 */
export function RichTextView({ value, course, go, className }: RichTextViewProps) {
  if (!value || richTextLength(value) === 0) return null;
  return (
    <div className={cn('space-y-3', className)}>
      {value.map((paragraph, index) => (
        <p key={index}>
          {paragraph.runs.every((run) => run.text === '') ? (
            <br />
          ) : (
            paragraph.runs.map((run, runIndex) => (
              <RunView key={runIndex} run={run} course={course} go={go} />
            ))
          )}
        </p>
      ))}
    </div>
  );
}

interface RunViewProps {
  run: TextRun;
  course: LinkCourse;
  go(link: Link): void;
}

function RunView({ run, course, go }: RunViewProps) {
  const marks = run.marks ?? [];
  let content: ReactNode = withLineBreaks(run.text);
  if (marks.includes('code')) {
    content = <code className="rounded-sm bg-fill px-1 font-mono">{content}</code>;
  }
  if (marks.includes('strike')) content = <s>{content}</s>;
  if (marks.includes('underline')) content = <u>{content}</u>;
  if (marks.includes('italic')) content = <em>{content}</em>;
  if (marks.includes('bold')) content = <strong>{content}</strong>;
  if (!run.link) return <>{content}</>;
  return (
    <LinkView link={run.link} course={course} go={go}>
      {content}
    </LinkView>
  );
}

function withLineBreaks(text: string): ReactNode {
  const lines = text.split('\n');
  if (lines.length === 1) return text;
  return lines.map((line, index) => (
    <Fragment key={index}>
      {index > 0 && <br />}
      {line}
    </Fragment>
  ));
}

interface LinkViewProps {
  link: Link;
  course: LinkCourse;
  go(link: Link): void;
  children: ReactNode;
}

function LinkView({ link, course, go, children }: LinkViewProps) {
  const target = linkTarget(course, link);
  switch (target.kind) {
    case 'broken':
      return (
        <span
          className="text-muted underline decoration-dotted underline-offset-2"
          title={target.reason}
        >
          {children}
          <VisuallyHidden> ({target.reason})</VisuallyHidden>
        </span>
      );
    case 'external':
    case 'file':
      return target.newTab ? (
        <a href={target.href} target="_blank" rel="noopener noreferrer" className={linkClasses}>
          {children}
          <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
        </a>
      ) : (
        <a href={target.href} className={linkClasses}>
          {children}
        </a>
      );
    case 'page':
    case 'lesson':
      return (
        <a
          href={target.href}
          className={linkClasses}
          onClick={(event) => {
            if (!isPlainClick(event)) return;
            event.preventDefault();
            go(link);
          }}
        >
          {children}
        </a>
      );
  }
}

/** A plain left click; Ctrl, Cmd, Shift or a middle click keep the browser's own behaviour. */
function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
