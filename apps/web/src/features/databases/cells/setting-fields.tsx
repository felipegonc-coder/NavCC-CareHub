import { Field, Input, Textarea } from '@carehub/ui';
import type { ReactNode } from 'react';
import { NativeSelect } from './controls';
import type { Draft } from './draft';
import { readChoice, type Choice } from './settings-logic';

/** A typed setting: Enter (single line) or leaving the field saves it. */
export function DraftField({
  label,
  draft,
  hint,
  multiline = false,
  maxLength,
  inputMode,
  disabled,
}: {
  label: string;
  draft: Draft;
  hint?: ReactNode;
  multiline?: boolean;
  maxLength?: number;
  inputMode?: 'decimal';
  disabled: boolean;
}) {
  return (
    <Field label={label} hint={hint} error={draft.error}>
      {multiline ? (
        <Textarea
          value={draft.value}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(event) => draft.change(event.target.value)}
          onBlur={() => draft.commit()}
        />
      ) : (
        <Input
          value={draft.value}
          maxLength={maxLength}
          inputMode={inputMode}
          disabled={disabled}
          onChange={(event) => draft.change(event.target.value)}
          onBlur={() => draft.commit()}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            draft.commit();
          }}
        />
      )}
    </Field>
  );
}

/** A setting picked from a list; it saves when the choice changes. */
export function ChoiceSetting<T extends string>({
  label,
  value,
  choices,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label}>
      <NativeSelect
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = readChoice(choices, event.target.value);
          if (next !== null && next !== value) onChange(next);
        }}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}
