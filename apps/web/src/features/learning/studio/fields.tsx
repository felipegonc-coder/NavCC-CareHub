import { Button } from '@carehub/ui';
import { useId } from 'react';
import type { JSX } from 'react';

/** Props for {@link ChoiceButtons}. */
export type ChoiceButtonsProps<T extends string | number> = {
  /** Shown above the buttons and names the group. */
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(next: T): void;
};

/** A few choices side by side; the chosen one is pressed. For block styles and settings with 2–4 options. */
export function ChoiceButtons<T extends string | number>(
  props: ChoiceButtonsProps<T>,
): JSX.Element {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-small font-medium text-fg">
        {props.label}
      </span>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1">
        {props.options.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={option.value === props.value ? 'secondary' : 'ghost'}
            aria-pressed={option.value === props.value}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** `item` with `key` set to `text`, or without `key` when `text` is blank (optional text in the format). */
export function withOptionalText<T extends object>(
  item: T,
  key: string & keyof T,
  text: string,
): T {
  const next: Record<string, unknown> = Object.fromEntries(Object.entries(item));
  if (text.trim() === '') delete next[key];
  else next[key] = text;
  return next as T;
}
