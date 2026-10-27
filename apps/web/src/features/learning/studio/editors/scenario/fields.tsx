import { plainText, type RichText } from '@carehub/learning';
import { cn, Input, useFieldControlProps } from '@carehub/ui';
import { useState, type ComponentProps } from 'react';

/** The kit's text field look, for the native select below (the kit doesn't export its classes). */
const SELECT_CLASSES =
  'flex h-9 w-full rounded border border-border bg-bg px-3 text-small text-fg transition-colors hover:border-border-hover disabled:cursor-not-allowed disabled:bg-fill disabled:text-faint max-md:h-11';

/** A native select in the kit's look; inside `Field` it takes the field's id and hint. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  const field = useFieldControlProps(props);
  return <select className={cn(SELECT_CLASSES, className)} {...props} {...field} />;
}

/** Props for {@link WholeNumberInput}. */
export type WholeNumberInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'onChange' | 'type' | 'min' | 'max' | 'step'
> & {
  value: number | undefined;
  min: number;
  max: number;
  /** Gets whole numbers kept between min and max. */
  onChange(next: number): void;
  /** Blank is allowed and calls this (optional numbers). */
  onClear?(): void;
};

const wholeNumber = (text: string): number | undefined => {
  const value = Number(text);
  return text.trim() === '' || !Number.isInteger(value) ? undefined : value;
};

/**
 * A whole number field. What's being typed ("-" or a blank) stays on screen until it is a number;
 * numbers out of range are brought back into it.
 */
export function WholeNumberInput(props: WholeNumberInputProps) {
  const { value, min, max, onChange, onClear, ...rest } = props;
  const [typed, setTyped] = useState<string | null>(null);
  const parsed = typed === null ? undefined : wholeNumber(typed);
  const shown =
    typed !== null && (parsed === undefined || parsed === value) ? typed : String(value ?? '');
  return (
    <Input
      {...rest}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={1}
      value={shown}
      onBlur={() => setTyped(null)}
      onChange={(event) => {
        const text = event.currentTarget.value;
        setTyped(text);
        const next = wholeNumber(text);
        if (next === undefined) {
          if (text.trim() === '' && value !== undefined) onClear?.();
          return;
        }
        const kept = Math.min(max, Math.max(min, next));
        if (kept !== value) onChange(kept);
      }}
    />
  );
}

/** `item` with `key` set to `text`, or without `key` when the text is blank (optional rich text). */
export function withRichText<T extends object>(item: T, key: string & keyof T, text: RichText): T {
  const next: Record<string, unknown> = Object.fromEntries(Object.entries(item));
  if (plainText(text).trim() === '') delete next[key];
  else next[key] = text;
  return next as T;
}
