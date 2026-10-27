import { Button, buttonClasses, cn } from '@carehub/ui';
import type { ReactNode } from 'react';
import { ScreenMessage } from '../../player/ScreenMessage';
import { NOT_FOUND, reportProblem } from './data';

// The layout the report screens share: the page, a table, the CSV download and load failures.

/** A report page: the browser tab's title and the page width of the other Learning pages. */
export function ReportPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main
      className={cn(
        'mx-auto flex w-full max-w-page flex-col gap-6 px-4 py-6 text-fg',
        'md:px-6 md:py-10',
      )}
    >
      <title>{`Care Hub · ${title}`}</title>
      {children}
    </main>
  );
}

/** A report table that scrolls sideways on small screens, with its caption for screen readers. */
export function ReportTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full border-collapse text-left text-small">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

/** Cell classes: headings, and the cells of each row. */
export const HEAD_CELL = 'whitespace-nowrap border-b border-border bg-fill px-3 py-2 font-medium';
export const CELL = 'border-b border-border px-3 py-2 align-top';

/** An empty cell: a dash on screen, "None" for screen readers. */
export function None() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">None</span>
    </>
  );
}

/** Downloads the report as a CSV file (the browser sends the sign-in cookie with it). */
export function CsvLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      download
      className={buttonClasses({ variant: 'secondary', className: 'self-start max-md:h-11' })}
    >
      Download CSV
    </a>
  );
}

/** A report that didn't load: why, in plain words, with Try again when it can help. */
export function ReportFailed({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  const problem = reportProblem(error);
  return (
    <ScreenMessage title={title} text={problem.text}>
      {problem.retry && (
        <Button onClick={onRetry} className="max-md:h-11">
          Try again
        </Button>
      )}
    </ScreenMessage>
  );
}

/** A report link with an id that can't be right. */
export function ReportNotFound({ title }: { title: string }) {
  return <ScreenMessage title={title} text={NOT_FOUND} />;
}
