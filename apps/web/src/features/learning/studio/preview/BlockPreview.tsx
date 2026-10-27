import type { Block, Lesson, Mark, RichText, TextRun } from '@carehub/learning';
import { cn } from '@carehub/ui';
import type { JSX, ReactNode } from 'react';
import { blockLabel } from '../labels';

// A read-only look at blocks for the Studio preview, until the player's block views land. Text blocks show as
// learners will see them; other blocks show a short note.

const MARKS: Record<Mark, (child: ReactNode) => JSX.Element> = {
  bold: (child) => <strong>{child}</strong>,
  italic: (child) => <em>{child}</em>,
  underline: (child) => <u>{child}</u>,
  strike: (child) => <s>{child}</s>,
  code: (child) => <code className="rounded bg-fill px-1 font-mono text-small">{child}</code>,
};

function Run({ run }: { run: TextRun }): JSX.Element {
  let node: ReactNode = run.text;
  for (const mark of run.marks ?? []) node = MARKS[mark](node);
  if (run.link?.kind === 'url')
    return (
      <a href={run.link.url} target="_blank" rel="noreferrer" className="text-primary underline">
        {node}
      </a>
    );
  return run.link ? <span className="underline">{node}</span> : <>{node}</>;
}

/** Rich text, read-only: one `<p>` per paragraph. */
export function RichTextView({ text }: { text: RichText }): JSX.Element {
  return (
    <>
      {text.map((paragraph, i) => (
        <p key={i} className="min-h-6">
          {paragraph.runs.map((run, j) => (
            <Run key={j} run={run} />
          ))}
        </p>
      ))}
    </>
  );
}

const HEADINGS = {
  1: { Tag: 'h3', className: 'text-h2' },
  2: { Tag: 'h4', className: 'text-h3' },
  3: { Tag: 'h5', className: 'text-body font-semibold' },
} as const;

const TONES: Record<
  Extract<Block, { type: 'callout' }>['tone'],
  { label: string; className: string }
> = {
  note: { label: 'Note', className: 'border-blue-text bg-blue-bg' },
  tip: { label: 'Tip', className: 'border-purple-text bg-purple-bg' },
  warning: { label: 'Warning', className: 'border-orange-text bg-orange-bg' },
  success: { label: 'Success', className: 'border-green-text bg-green-bg' },
};

function Quote(props: { text: string; attribution?: string | undefined }): JSX.Element {
  return (
    <figure className="flex flex-col gap-2 border-l-4 border-border pl-4">
      <blockquote className="text-h3 text-fg">{props.text}</blockquote>
      {props.attribution && (
        <figcaption className="text-small text-muted">{props.attribution}</figcaption>
      )}
    </figure>
  );
}

/** One block, read-only. `narrow` lays it out for phone width; `number` is a numbered divider's number. */
export function BlockPreview(props: {
  block: Block;
  narrow: boolean;
  number?: number | undefined;
}): JSX.Element {
  const { block, narrow } = props;
  switch (block.type) {
    case 'heading': {
      const { Tag, className } = HEADINGS[block.level];
      return <Tag className={cn(className, 'text-fg')}>{block.text}</Tag>;
    }
    case 'paragraph':
      return (
        <div className="flex flex-col gap-3">
          <RichTextView text={block.text} />
        </div>
      );
    case 'list': {
      if (block.style === 'checkbox')
        return (
          <ul className="flex flex-col gap-1">
            {block.items.map((item) => (
              <li key={item.id} className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0 rounded border border-border"
                />
                <div className="min-w-0">
                  <RichTextView text={item.text} />
                </div>
              </li>
            ))}
          </ul>
        );
      const items = block.items.map((item) => (
        <li key={item.id}>
          <RichTextView text={item.text} />
        </li>
      ));
      return block.style === 'numbered' ? (
        <ol className="flex list-decimal flex-col gap-1 pl-6">{items}</ol>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-6">{items}</ul>
      );
    }
    case 'callout': {
      const tone = TONES[block.tone];
      return (
        <div
          role="note"
          aria-label={tone.label}
          className={cn('flex flex-col gap-1 rounded border-l-4 p-4 text-fg', tone.className)}
        >
          {block.title && <p className="font-semibold">{block.title}</p>}
          <RichTextView text={block.text} />
        </div>
      );
    }
    case 'statement':
      return <p className="text-h2 text-fg">{block.text}</p>;
    case 'quote':
      return <Quote text={block.text} attribution={block.attribution} />;
    case 'quote_carousel':
      return (
        <div className="flex flex-col gap-4">
          {block.quotes.map((quote) => (
            <Quote key={quote.id} text={quote.text} attribution={quote.attribution} />
          ))}
        </div>
      );
    case 'two_column':
      return (
        <div className={cn('grid gap-4', !narrow && 'grid-cols-2')}>
          <div className="flex flex-col gap-3">
            <RichTextView text={block.left} />
          </div>
          <div className="flex flex-col gap-3">
            <RichTextView text={block.right} />
          </div>
        </div>
      );
    case 'divider':
      if (block.style === 'spacer') return <div aria-hidden="true" className="h-8" />;
      if (block.style === 'line' || props.number === undefined)
        return <hr className="border-border" />;
      return (
        <div className="flex items-center gap-3">
          <hr className="flex-1 border-border" />
          <span className="text-small font-semibold text-muted">{props.number}</span>
          <hr className="flex-1 border-border" />
        </div>
      );
    case 'code':
      return (
        <figure className="flex flex-col gap-1">
          {block.language && (
            <figcaption className="text-label text-muted">{block.language}</figcaption>
          )}
          <pre className="overflow-x-auto rounded bg-fill p-3 font-mono text-small text-fg">
            <code>{block.code}</code>
          </pre>
        </figure>
      );
    case 'table': {
      const [first = [], ...rest] = block.rows;
      const body = block.headerRow ? rest : block.rows;
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-small text-fg">
            {block.headerRow && (
              <thead>
                <tr>
                  {first.map((cell, i) => (
                    <th
                      key={i}
                      scope="col"
                      className="border border-border p-2 text-left font-semibold"
                    >
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td key={i} className="border border-border p-2">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'continue': {
      const label = block.label ?? 'Continue';
      return (
        <p className="rounded border border-dashed border-border p-3 text-small text-muted">
          {block.requires === 'complete_above'
            ? `Learners finish the blocks above, then press “${label}” to see the rest of the lesson.`
            : `Learners press “${label}” to see the rest of the lesson.`}
        </p>
      );
    }
    default:
      return (
        <p className="rounded border border-dashed border-border p-4 text-small text-muted">
          {`${blockLabel(block)}: this block can't be shown in the preview yet. Learners see it in the course.`}
        </p>
      );
  }
}

/** A lesson's content, read-only. Quizzes can't be tried here yet, so they show what they hold. */
export function LessonPreview({
  lesson,
  narrow,
}: {
  lesson: Lesson;
  narrow: boolean;
}): JSX.Element {
  if (lesson.kind === 'quiz') {
    const count =
      lesson.questions.length + (lesson.bankDraws ?? []).reduce((n, draw) => n + draw.count, 0);
    return (
      <div className="flex flex-col gap-3 text-body text-fg">
        {lesson.intro && <RichTextView text={lesson.intro} />}
        <p className="rounded border border-dashed border-border p-4 text-small text-muted">
          {`A quiz with ${count} question${count === 1 ? '' : 's'} and a pass mark of ${lesson.settings.passMark}%. Quizzes can't be tried in the preview yet.`}
        </p>
      </div>
    );
  }
  if (lesson.blocks.length === 0)
    return <p className="text-body text-muted">This lesson has no blocks yet.</p>;
  let numbered = 0;
  return (
    <div className="flex flex-col gap-4 text-body text-fg">
      {lesson.blocks.map((block) => (
        <BlockPreview
          key={block.id}
          block={block}
          narrow={narrow}
          number={
            block.type === 'divider' && block.style === 'numbered' ? (numbered += 1) : undefined
          }
        />
      ))}
    </div>
  );
}
