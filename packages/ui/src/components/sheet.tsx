import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { useFocusReturn } from '../lib/focus-return';
import { IconButton } from './icon-button';

export interface SheetContentProps extends Omit<
  ComponentProps<typeof DialogPrimitive.Content>,
  'title'
> {
  /** Read by screen readers when the panel opens. */
  title: string;
  closeLabel?: string;
}

/**
 * A panel that slides in from the left edge, such as the phone menu; on a phone it covers the
 * whole screen. Put it inside <Dialog>: focus stays inside, Escape closes it, and focus goes back
 * to what opened it.
 */
export function SheetContent({
  title,
  closeLabel = 'Close',
  className,
  children,
  ...props
}: SheetContentProps) {
  const focusReturn = useFocusReturn(props);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 animate-fade-in bg-overlay/50" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-sidebar max-w-full animate-slide-in-left flex-col bg-bg text-fg shadow-dialog focus:outline-none max-md:w-full',
          className,
        )}
        {...props}
        {...focusReturn}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        {children}
        <DialogPrimitive.Close asChild>
          <IconButton label={closeLabel} size="sm" className="absolute right-2 top-2">
            <X aria-hidden />
          </IconButton>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
