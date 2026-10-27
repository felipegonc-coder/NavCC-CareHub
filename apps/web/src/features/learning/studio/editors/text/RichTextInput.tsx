import { useState } from 'react';
import type { JSX } from 'react';
import { LIMITS } from '@carehub/learning';
import type { Course, Mark, RichText } from '@carehub/learning';
import { Input, Textarea } from '@carehub/ui';
import { plainTextToRichText, richTextToPlainText } from './plain-text';

// The one way to edit course rich text (docs/learning/PLAN.md, "Shared web contracts"; decision 0306). Until the
// editor's RichTextField lands it is a plain text area: a blank line starts a new paragraph, and paragraphs whose
// text didn't change keep their formatting and links. The props stay the same when it switches to the editor.

/** Props for {@link RichTextInput}. */
export type RichTextInputProps = {
  value: RichText;
  onChange(next: RichText): void;
  /** The accessible name, for example "Paragraph text". */
  ariaLabel: string;
  placeholder?: string;
  /** One line (titles, options): line breaks become spaces. */
  singleLine?: boolean;
  /** The marks people can add; all five when left out. Used once the editor lands. */
  marks?: Mark[];
  /** The course the text belongs to, so links can point at its lessons. Used once the editor lands. */
  course?: Course;
  id?: string;
  ariaDescribedBy?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
};

const sameRichText = (a: RichText, b: RichText): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

/** Rich text field for course content (a plain text area for now). Works inside `@carehub/ui`'s `Field`. */
export function RichTextInput(props: RichTextInputProps): JSX.Element {
  const { value, onChange, singleLine = false } = props;
  // What was typed and the value it gave. The field shows it while the value is still that one, so blank lines
  // being typed don't vanish; after undo or any change from outside, it shows the new value instead.
  const [typed, setTyped] = useState<{ text: string; value: RichText } | null>(null);
  const text =
    typed !== null && sameRichText(typed.value, value) ? typed.text : richTextToPlainText(value);

  const change = (next: string) => {
    const nextValue = plainTextToRichText(next, value, singleLine);
    setTyped({ text: next, value: nextValue });
    if (!sameRichText(nextValue, value)) onChange(nextValue);
  };
  const shared = {
    id: props.id,
    value: text,
    placeholder: props.placeholder,
    autoFocus: props.autoFocus,
    readOnly: props.readOnly,
    maxLength: LIMITS.richText,
    'aria-label': props.ariaLabel,
    'aria-describedby': props.ariaDescribedBy,
  };
  if (singleLine) {
    return <Input type="text" {...shared} onChange={(e) => change(e.currentTarget.value)} />;
  }
  return (
    <Textarea
      {...shared}
      rows={Math.min(Math.max(text.split('\n').length, 3), 12)}
      onChange={(e) => change(e.currentTarget.value)}
    />
  );
}
