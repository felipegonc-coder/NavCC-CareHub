import { Slot } from '@radix-ui/react-slot';
import type { ComponentProps } from 'react';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './classes';
import { Spinner } from './spinner';

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and ignores clicks, but keeps the button focusable. */
  loading?: boolean;
  /** Give the child element (for example a link) the button look instead of rendering a <button>. */
  asChild?: boolean;
}

export function Button({
  variant,
  size,
  loading = false,
  asChild = false,
  type = 'button',
  className,
  children,
  ...props
}: ButtonProps) {
  const classes = buttonClasses({ variant, size, className });
  if (asChild) {
    return (
      <Slot className={classes} {...props}>
        {children}
      </Slot>
    );
  }
  return (
    <button
      type={type}
      className={classes}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      {...props}
      onClick={(event) => {
        if (loading) event.preventDefault();
        else props.onClick?.(event);
      }}
    >
      {loading && <Spinner decorative />}
      {children}
    </button>
  );
}
