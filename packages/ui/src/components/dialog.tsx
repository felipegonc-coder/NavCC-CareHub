import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { useFocusReturn } from '../lib/focus-return';
import { bottomSheetClasses } from './classes';
import { IconButton } from './icon-button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * Centred dialog with a dimmed backdrop; on a phone, a bottom sheet. Focus stays inside; Escape
 * closes it, and focus goes back to what opened it, also when that wasn't a `DialogTrigger`.
 */
export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  const focusReturn = useFocusReturn(props);
  return (
    <DialogPrimitive.Portal>
      {/* The backdrop holds the dialog, so a dialog taller than the window scrolls with it. */}
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 grid animate-fade-in overflow-y-auto bg-overlay/50 p-4 max-md:px-0 max-md:pb-0">
        <DialogPrimitive.Content
          className={cn(
            'relative m-auto grid w-full max-w-dialog gap-4 rounded border border-border bg-bg p-6 text-fg shadow-dialog animate-pop-in focus:outline-none',
            bottomSheetClasses,
            'max-md:mx-0 max-md:mb-0',
            className,
          )}
          {...props}
          {...focusReturn}
        >
          {children}
          <DialogPrimitive.Close asChild>
            <IconButton label="Close" size="sm" className="absolute right-3 top-3">
              <X aria-hidden />
            </IconButton>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Overlay>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 pr-8', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-body font-semibold', className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn('text-small text-muted', className)} {...props} />
  );
}
