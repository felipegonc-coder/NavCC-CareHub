import type { ReactNode } from 'react';
import type { RichText as RichTextValue, RichTextSpan } from '@carehub/databases';
import { isRichTextEmpty, isSafeWebLink } from '@carehub/databases';
import { cn } from '@carehub/ui';
import { LINK_CLASS, MARK_LOOKS, colorClass } from './rich-style';

function Span({ span }: { span: RichTextSpan }) {
  const marks = span.marks ?? [];
  let node: ReactNode = span.text;
  for (const look of MARK_LOOKS) {
    if (!marks.includes(look.mark)) continue;
    const Tag = look.tag;
    node = <Tag className={look.className}>{node}</Tag>;
  }
  const color = colorClass(span.color);
  if (color) {
    node = (
      <span className={color} data-color={span.color}>
        {node}
      </span>
    );
  }
  if (span.link && isSafeWebLink(span.link)) {
    node = (
      <a href={span.link} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
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
