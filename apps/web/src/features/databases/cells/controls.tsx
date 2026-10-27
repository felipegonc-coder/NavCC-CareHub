import { cn, useFieldControlProps } from '@carehub/ui';
import type { ComponentProps } from 'react';

/** The design kit's text field look (its controlClasses aren't exported). */
export const CONTROL_CLASSES =
  'flex w-full rounded border border-border bg-bg px-3 text-small text-fg transition-colors hover:border-border-hover disabled:cursor-not-allowed disabled:bg-fill disabled:text-faint aria-[invalid=true]:border-danger';

/** A native select in the kit's look; inside <Field> it takes the field's id, hint and error. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  const field = useFieldControlProps(props);
  return <select className={cn(CONTROL_CLASSES, 'h-9', className)} {...props} {...field} />;
}
