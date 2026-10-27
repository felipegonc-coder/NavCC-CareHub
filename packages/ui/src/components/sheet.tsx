import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
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
 * A panel that slides in from the left edge, such as the phone menu. Put it inside <Dialog>:
 * focus stays inside, Escape closes it, and focus goes back to what opened it.
 */
export function SheetContent({
  title,
  closeLabel = 'Close',
  className,
  children,
  ...props
}: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 animate-fade-in bg-black/50" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-sidebar max-w-[85vw] animate-slide-in-left flex-col bg-bg text-fg shadow-dialog focus:outline-none',
          className,
        )}
        {...props}
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
