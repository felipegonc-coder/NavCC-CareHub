import { cn } from '../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const buttonBase =
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded text-small font-medium transition-colors disabled:pointer-events-none disabled:text-faint aria-busy:cursor-wait [&_svg]:size-4 [&_svg]:shrink-0';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover disabled:bg-fill',
  secondary: 'border border-border bg-bg text-fg hover:border-border-hover hover:bg-fill-hover',
  ghost: 'text-fg hover:bg-fill-hover',
  danger: 'bg-danger text-bg hover:bg-danger/90 disabled:bg-fill',
};

const buttonSizes: Record<ButtonSize, { text: string; icon: string }> = {
  sm: { text: 'h-8 px-3', icon: 'size-8' },
  md: { text: 'h-9 px-4', icon: 'size-9' },
};

export interface ButtonClassOptions {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  /** Square button that holds only an icon. */
  icon?: boolean | undefined;
  className?: string | undefined;
}

/** Button look, also for links and menu triggers that should look like buttons. */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  icon = false,
  className,
}: ButtonClassOptions = {}): string {
  const sizes = buttonSizes[size];
  return cn(buttonBase, buttonVariants[variant], icon ? sizes.icon : sizes.text, className);
}

/** Text fields and select triggers. */
export const controlClasses =
  'flex w-full rounded border border-border bg-bg px-3 text-small text-fg transition-colors hover:border-border-hover disabled:cursor-not-allowed disabled:bg-fill disabled:text-faint aria-[invalid=true]:border-danger';

/** Menus, select lists and popovers. */
export const surfaceClasses =
  'z-50 overflow-hidden rounded border border-border bg-bg p-1 text-fg shadow-menu animate-pop-in focus:outline-none';

/** One row in a menu or list. Keyboard focus keeps its outline, drawn inside the row. */
export const menuItemClasses =
  'relative flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-small focus-visible:outline-offset-[-2px] data-[disabled]:pointer-events-none data-[highlighted]:bg-fill-hover data-[disabled]:text-faint [&_svg]:size-4 [&_svg]:shrink-0';
