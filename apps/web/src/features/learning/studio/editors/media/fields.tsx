import { plainText, type Course, type RichText } from '@carehub/learning';
import { Field, useFieldControlProps } from '@carehub/ui';
import type { ReactNode } from 'react';
import { RichTextInput, type RichTextInputProps } from '../text/RichTextInput';

/** A copy of `item` with `key` set, or without it when `value` is undefined (optional fields stay out). */
export function withOptional<T extends object, K extends keyof T>(
  item: T,
  key: K,
  value: T[K] | undefined,
): T {
  const next = { ...item };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

/** Optional rich text left empty is stored as nothing. */
export const optionalRichText = (value: RichText): RichText | undefined =>
  plainText(value).trim() === '' ? undefined : value;

/** Optional plain text left empty is stored as nothing. */
export const optionalText = (value: string): string | undefined =>
  value.trim() === '' ? undefined : value;

/** B8's RichTextInput, labelled and described by the Field around it. */
function FieldRichTextInput(props: RichTextInputProps) {
  const control = useFieldControlProps({});
  return <RichTextInput {...props} id={control.id} ariaDescribedBy={control['aria-describedby']} />;
}

export type RichTextFieldProps = {
  label: string;
  hint?: ReactNode;
  value: RichText | undefined;
  onChange(next: RichText): void;
  course: Course;
};

/** A labelled rich-text box (B8's RichTextInput, the one rich-text input). */
export function RichTextField({ label, hint, value, onChange, course }: RichTextFieldProps) {
  return (
    <Field label={label} hint={hint}>
      <FieldRichTextInput
        ariaLabel={label}
        value={value ?? []}
        onChange={onChange}
        course={course}
      />
    </Field>
  );
}
