import { useState, type ComponentProps, type ReactNode } from 'react';
import { Input, Switch, Textarea, cn } from '@carehub/ui';

/**
 * Text the builder saves when the person leaves the box (or presses Enter in a one-line box), not
 * on every key. What they typed stays shown until the saved value changes.
 */
function useCommit(value: string, onCommit: (next: string) => void) {
  const [edit, setEdit] = useState<{ base: string; text: string } | null>(null);
  const editing = edit !== null && edit.base === value;
  return {
    shown: editing ? edit.text : value,
    setText: (text: string) => setEdit({ base: value, text }),
    commit: () => {
      if (editing && edit.text !== value) onCommit(edit.text);
    },
  };
}

type CommitProps<T extends 'input' | 'textarea'> = Omit<
  ComponentProps<T>,
  'value' | 'defaultValue' | 'onChange'
> & {
  value: string;
  onCommit(next: string): void;
};

export function CommitInput({
  value,
  onCommit,
  onBlur,
  onKeyDown,
  ...props
}: CommitProps<'input'>) {
  const text = useCommit(value, onCommit);
  return (
    <Input
      {...props}
      value={text.shown}
      onChange={(event) => text.setText(event.target.value)}
      onBlur={(event) => {
        text.commit();
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.altKey) text.commit();
        onKeyDown?.(event);
      }}
    />
  );
}

export function CommitTextarea({ value, onCommit, onBlur, ...props }: CommitProps<'textarea'>) {
  const text = useCommit(value, onCommit);
  return (
    <Textarea
      {...props}
      value={text.shown}
      onChange={(event) => text.setText(event.target.value)}
      onBlur={(event) => {
        text.commit();
        onBlur?.(event);
      }}
    />
  );
}

/** A plain dropdown with the kit's text-field look, for the builder's short lists. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 w-full rounded border border-border bg-bg px-2 text-small text-fg transition-colors hover:border-border-hover disabled:cursor-not-allowed disabled:bg-fill disabled:text-faint',
        className,
      )}
      {...props}
    />
  );
}

/** A switch with its label after it and an optional hint under both. */
export function SwitchField({
  id,
  label,
  checked,
  onChange,
  disabled,
  hint,
  onKeyDown,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
  hint?: ReactNode;
  onKeyDown?: ComponentProps<'button'>['onKeyDown'];
}) {
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onChange}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
          onKeyDown={onKeyDown}
        />
        <label htmlFor={id} className="text-small text-fg">
          {label}
        </label>
      </div>
      {hint && (
        <p id={hintId} className="text-small text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
