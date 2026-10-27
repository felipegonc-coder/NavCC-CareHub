import type { Course, RichText } from '@carehub/learning';
import { Field } from '@carehub/ui';
import type { JSX, ReactNode } from 'react';
import { RichTextInput } from '../text/RichTextInput';

/** Props for {@link RichTextField}. */
export type RichTextFieldProps = {
  label: string;
  hint?: ReactNode;
  value: RichText | undefined;
  onChange(next: RichText): void;
  course: Course;
};

/** B8's RichTextInput (the one rich text input) with a label and a hint. */
export function RichTextField({
  label,
  hint,
  value,
  onChange,
  course,
}: RichTextFieldProps): JSX.Element {
  return (
    <Field label={label} hint={hint}>
      <RichTextInput ariaLabel={label} value={value ?? []} course={course} onChange={onChange} />
    </Field>
  );
}
