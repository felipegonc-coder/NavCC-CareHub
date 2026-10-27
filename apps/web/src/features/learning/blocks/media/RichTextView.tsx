import {
  linkTarget,
  type Course,
  type Link,
  type Mark,
  type RichText,
  type TextRun,
} from '@carehub/learning';
import { cn, VisuallyHidden } from '@carehub/ui';
import type { MouseEvent, ReactNode } from 'react';

export type RichTextViewProps = {
  value: RichText | undefined;
  course: Pick<Course, 'id' | 'lessons'>;
  /** Follows a lesson or Care Hub page link inside the app. */
  go(link: Link): void;
  className?: string;
};

const MARKS: Readonly<Record<Mark, (children: ReactNode) => ReactNode>> = {
  bold: (children) => <strong>{children}</strong>,
  italic: (children) => <em>{children}</em>,
  underline: (children) => <u>{children}</u>,
  strike: (children) => <s>{children}</s>,
  code: (children) => <code className="rounded bg-fill px-1 font-mono text-small">{children}</code>,
};

/** True when the person asked for a new tab or window (Ctrl, Cmd, Shift or the middle button). */
const wantsNewTab = (event: MouseEvent) =>
  event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;

/**
 * Rich text, read-only: paragraphs, marks and links; lesson and page links open through `go`. A stand-in until
 * the shared rich text view for text blocks (B5) lands, then this file only re-exports it.
 */
export function RichTextView({ value, course, go, className }: RichTextViewProps) {
  if (!value?.some((paragraph) => paragraph.runs.length > 0)) return null;
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {value.map((paragraph, i) => (
        <p key={i}>
          {paragraph.runs.map((run, j) => (
            <Run key={j} run={run} course={course} go={go} />
          ))}
        </p>
      ))}
    </div>
  );
}

function Run({ run, course, go }: { run: TextRun } & Pick<RichTextViewProps, 'course' | 'go'>) {
  const text = (run.marks ?? []).reduce<ReactNode>((node, mark) => MARKS[mark](node), run.text);
  const link = run.link;
  if (!link) return <>{text}</>;
  const target = linkTarget(course, link);
  if (target.kind === 'broken') return <>{text}</>;
  const inApp = target.kind === 'lesson' || target.kind === 'page';
  const newTab = target.kind === 'external' && target.newTab;
  return (
    <a
      href={target.href}
      className="underline underline-offset-2 hover:text-muted"
      {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      onClick={(event) => {
        if (!inApp || wantsNewTab(event)) return;
        event.preventDefault();
        go(link);
      }}
    >
      {text}
      {newTab && <VisuallyHidden> (opens in a new tab)</VisuallyHidden>}
    </a>
  );
}
