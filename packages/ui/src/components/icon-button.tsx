import type { ComponentProps } from 'react';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './classes';

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'aria-label'> {
  /** What the button does, for screen readers ("Close", "Change theme"). */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** A square button holding only an icon. */
export function IconButton({
  label,
  variant = 'ghost',
  size,
  type = 'button',
  className,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={buttonClasses({ variant, size, icon: true, className })}
      {...props}
    />
  );
}
