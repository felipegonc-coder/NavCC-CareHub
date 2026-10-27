import type {
  CodeBlock,
  DividerBlock,
  HeadingBlock,
  ParagraphBlock,
  StatementBlock,
  TableBlock,
  TwoColumnBlock,
} from '@carehub/learning';
import { cn } from '@carehub/ui';
import type { BlockViewProps } from '../registry';
import { RichTextView } from './RichTextView';

// The lesson title is the page's h1, so a level 1 heading is an h2, and so on.
const HEADINGS = {
  1: { Tag: 'h2', size: 'text-h1' },
  2: { Tag: 'h3', size: 'text-h2' },
  3: { Tag: 'h4', size: 'text-h3' },
} as const;

export function HeadingView({ block }: BlockViewProps<HeadingBlock>) {
  const { Tag, size } = HEADINGS[block.level];
  return <Tag className={cn('font-semibold text-fg', size)}>{block.text}</Tag>;
}

export function ParagraphView({ block, course, go }: BlockViewProps<ParagraphBlock>) {
  return <RichTextView value={block.text} course={course} go={go} />;
}

/** A short statement that stands out, between two lines. */
export function StatementView({ block }: BlockViewProps<StatementBlock>) {
  return (
    <p className="whitespace-pre-line border-y border-border py-6 text-center text-h2 font-semibold text-fg">
      {block.text}
    </p>
  );
}

/** Two columns of text side by side; one under the other on phones. */
export function TwoColumnView({ block, course, go }: BlockViewProps<TwoColumnBlock>) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <RichTextView value={block.left} course={course} go={go} />
      </div>
      <div>
        <RichTextView value={block.right} course={course} go={go} />
      </div>
    </div>
  );
}

/** A line, some space, or a numbered break (1, 2, 3 … through the lesson). */
export function DividerView({ block, lesson }: BlockViewProps<DividerBlock>) {
  if (block.style === 'spacer') return <div aria-hidden className="h-8" />;
  if (block.style === 'line') return <hr className="border-border" />;
  const numbered = lesson.blocks.filter(
    (candidate) => candidate.type === 'divider' && candidate.style === 'numbered',
  );
  const number = numbered.findIndex((candidate) => candidate.id === block.id) + 1 || 1;
  return (
    <div role="separator" aria-label={`Part ${number}`} className="flex items-center gap-4">
      <span className="h-px flex-1 bg-border" />
      <span className="flex size-10 items-center justify-center rounded-full border border-border text-small font-semibold text-fg">
        {number}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Code to read (never run). Long lines wrap, so phones don't scroll sideways. */
export function CodeView({ block }: BlockViewProps<CodeBlock>) {
  return (
    <figure className="space-y-1">
      {block.language && (
        <figcaption className="text-label text-muted">{block.language}</figcaption>
      )}
      <pre className="whitespace-pre-wrap break-words rounded border border-border bg-fill p-4 font-mono text-small text-fg">
        <code>{block.code}</code>
      </pre>
    </figure>
  );
}

const CELL = 'break-words border border-border px-3 py-2 text-left align-top';

/** A table; with `headerRow` its first row holds the column headings. */
export function TableView({ block }: BlockViewProps<TableBlock>) {
  const head = block.headerRow ? block.rows[0] : undefined;
  const body = block.headerRow ? block.rows.slice(1) : block.rows;
  if (!head && body.length === 0) return <></>;
  return (
    <table className="w-full table-fixed border-collapse text-small text-fg">
      {head && (
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index} scope="col" className={cn(CELL, 'bg-fill font-semibold')}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {body.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, index) => (
              <td key={index} className={CELL}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
