import type { SearchIcon, SearchResult, TextRange } from '@carehub/extras/search';
import { format, isSameYear } from 'date-fns';
import { Database, FileText, Rows3 } from 'lucide-react';
import { segments } from './keys';

const KINDS = {
  page: { word: 'page', Icon: FileText },
  database: { word: 'database', Icon: Database },
  row: { word: 'row', Icon: Rows3 },
} as const;

/** "Oct 20", with the year when it isn't this year. */
export function dayOf(iso: string, now = new Date()): string {
  const date = new Date(iso);
  return format(date, isSameYear(date, now) ? 'MMM d' : 'MMM d, yyyy');
}

export const titleOf = (result: SearchResult) => result.title || 'Untitled';

/** What a screen reader hears: "Refund steps, page in Support › Policies, edited Oct 20" (spec 6). */
export function resultLabel(result: SearchResult, now = new Date()): string {
  const where = result.path.length > 0 ? ` in ${result.path.join(' › ')}` : '';
  return `${titleOf(result)}, ${KINDS[result.kind].word}${where}, edited ${dayOf(result.editedAt, now)}`;
}

function Marked({
  text,
  ranges,
  as: Tag,
}: {
  text: string;
  ranges: readonly TextRange[];
  as: 'strong' | 'mark';
}) {
  return segments(text, ranges).map((part, index) =>
    part.match ? (
      <Tag
        key={index}
        className={Tag === 'mark' ? 'rounded-sm bg-warning/20 text-fg' : 'font-semibold'}
      >
        {part.text}
      </Tag>
    ) : (
      part.text
    ),
  );
}

export function ResultIcon({
  icon,
  kind,
}: {
  icon: SearchIcon | null;
  kind: SearchResult['kind'];
}) {
  if (icon?.type === 'emoji') {
    return (
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
        {icon.emoji}
      </span>
    );
  }
  const { Icon } = KINDS[kind];
  return (
    <span aria-hidden className="flex size-5 shrink-0 items-center justify-center text-muted">
      <Icon className="size-4" />
    </span>
  );
}

function Badge({ children }: { children: string }) {
  return <span className="shrink-0 rounded-sm border px-1 text-label text-muted">{children}</span>;
}

/**
 * A result: icon, title with the matching words in bold, path, up to 2 lines of the best block
 * with the matching words highlighted, who edited it last, and badges (spec 2).
 */
export function ResultContent({
  result,
  compact = false,
}: {
  result: SearchResult;
  compact?: boolean;
}) {
  return (
    <>
      <ResultIcon icon={result.icon} kind={result.kind} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">
            <Marked text={titleOf(result)} ranges={result.titleRanges} as="strong" />
          </span>
          {result.kind === 'database' && <Badge>Database</Badge>}
          {result.rowIn !== null && <Badge>{`Row in ${result.rowIn}`}</Badge>}
          {result.verified && <Badge>✓ Verified</Badge>}
          {result.archived && <Badge>Archived</Badge>}
        </span>
        {result.path.length > 0 && (
          <span className="truncate text-label text-muted">{result.path.join(' › ')}</span>
        )}
        {!compact && result.snippet && (
          <span className="line-clamp-2 text-label text-muted">
            <Marked text={result.snippet.text} ranges={result.snippet.ranges} as="mark" />
          </span>
        )}
        {!compact && (
          <span className="text-label text-muted">
            {`Edited ${dayOf(result.editedAt)}${result.editedBy ? ` by ${result.editedBy.name}` : ''}`}
          </span>
        )}
      </span>
    </>
  );
}
