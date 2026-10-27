import type { ComponentProps } from 'react';
import { cn } from '@carehub/ui';

/**
 * The one place the fill screen draws floating panels (the pickers' option lists). When the design
 * kit's popovers land (PR #27), this file switches to them and nothing else changes.
 */
export function FloatingPanel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded border border-border bg-bg p-1 text-fg shadow-menu',
        className,
      )}
      {...props}
    />
  );
}
