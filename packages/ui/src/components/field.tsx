import { useId, useMemo, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FieldContext } from './field-context';

export function Label({ className, htmlFor, ...props }: ComponentProps<'label'>) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('text-small font-medium text-fg', className)}
      {...props}
    />
  );
}

export interface FieldProps {
  label: ReactNode;
  /** Help shown under the control and read with it. */
  hint?: ReactNode;
  /** Shown in red; also marks the control invalid. */
  error?: ReactNode;
  required?: boolean;
  /** 'inline' puts a checkbox or switch before its label. */
  layout?: 'stacked' | 'inline';
  id?: string;
  className?: string;
  children: ReactNode;
}

/** Label, control, hint and error, wired together for screen readers. */
export function Field({
  label,
  hint,
  error,
  required = false,
  layout = 'stacked',
  id,
  className,
  children,
}: FieldProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const value = useMemo(
    () => ({ id: controlId, hintId, errorId, invalid: Boolean(error), required }),
    [controlId, hintId, errorId, error, required],
  );
  const inline = layout === 'inline';
  const labelElement = (
    <Label htmlFor={controlId}>
      {label}
      {required && (
        <span aria-hidden className="text-danger">
          {' *'}
        </span>
      )}
    </Label>
  );

  return (
    <FieldContext value={value}>
      <div
        className={cn(
          inline
            ? 'grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1'
            : 'flex flex-col gap-1.5',
          className,
        )}
      >
        {inline ? children : labelElement}
        {inline ? labelElement : children}
        {hint && (
          <p id={hintId} className={cn('text-small text-muted', inline && 'col-start-2')}>
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className={cn('text-small text-danger', inline && 'col-start-2')}>
            {error}
          </p>
        )}
      </div>
    </FieldContext>
  );
}
