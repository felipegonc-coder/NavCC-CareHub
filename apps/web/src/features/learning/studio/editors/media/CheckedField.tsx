import { Field, Input } from '@carehub/ui';
import { useState, type ComponentProps, type ReactNode } from 'react';

/** What a typed value means: one the format accepts, or why not. */
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export type CheckedFieldProps<T> = {
  label: string;
  hint?: ReactNode;
  /** The stored value, as text. */
  value: string;
  check(text: string): Checked<T>;
  onChange(next: T): void;
  input?: Omit<ComponentProps<typeof Input>, 'value' | 'onChange'>;
};

/**
 * A text box for values the format is strict about (links, language tags, numbers in a range). Only accepted
 * values reach the block, so a draft always saves; until then it keeps what was typed and says what's wrong.
 */
export function CheckedField<T>({
  label,
  hint,
  value,
  check,
  onChange,
  input,
}: CheckedFieldProps<T>) {
  const [draft, setDraft] = useState(value);
  const [stored, setStored] = useState(value);
  if (value !== stored) {
    // Changed elsewhere (undo, or the accepted form of what was typed).
    setStored(value);
    setDraft(value);
  }
  const checked = check(draft);
  return (
    <Field label={label} hint={hint} error={checked.ok ? undefined : checked.error}>
      <Input
        {...input}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          const next = check(event.target.value);
          if (next.ok) onChange(next.value);
        }}
      />
    </Field>
  );
}
