import type { ReactNode } from 'react';
import type { RichText as RichTextValue, RichTextSpan, TextColor } from '@carehub/databases';
import { isRichTextEmpty, isSafeWebLink } from '@carehub/databases';
import { cn, colorClasses, isColorName } from '@carehub/ui';

const BACKGROUND = '_background';

/** The kit class for a picked text or background colour. */
function colorClass(color: TextColor | undefined): string | null {
  if (!color) return null;
  const background = color.endsWith(BACKGROUND);
  const name = background ? color.slice(0, -BACKGROUND.length) : color;
  if (!isColorName(name)) return null;
  return background ? cn(colorClasses[name].bg, 'rounded px-0.5') : colorClasses[name].text;
}

function Span({ span }: { span: RichTextSpan }) {
  const marks = span.marks ?? [];
  let node: ReactNode = span.text;
  if (marks.includes('code')) {
    node = <code className="rounded bg-fill px-1 font-mono text-small">{node}</code>;
  }
  if (marks.includes('bold')) node = <strong className="font-semibold">{node}</strong>;
  if (marks.includes('italic')) node = <em>{node}</em>;
  if (marks.includes('underline')) node = <u>{node}</u>;
  if (marks.includes('strike')) node = <s>{node}</s>;
  const color = colorClass(span.color);
  if (color) node = <span className={color}>{node}</span>;
  if (span.link && isSafeWebLink(span.link)) {
    node = (
      <a
        href={span.link}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:text-primary-hover"
      >
        {node}
      </a>
    );
  }
  return <>{node}</>;
}

/**
 * A form's description, a question's description or the confirmation: bold, italic, underline,
 * strikethrough, code, colours and links (opening in a new tab). Nothing when empty.
 */
export function RichText({
  value,
  id,
  className,
}: {
  value: RichTextValue;
  id?: string;
  className?: string;
}) {
  if (isRichTextEmpty(value)) return null;
  return (
    <p id={id} className={cn('whitespace-pre-wrap break-words', className)}>
      {value.map((span, i) => (
        <Span key={i} span={span} />
      ))}
    </p>
  );
}
