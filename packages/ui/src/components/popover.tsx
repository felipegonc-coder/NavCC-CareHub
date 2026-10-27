import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { bottomSheetClasses, surfaceClasses } from './classes';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

/** Opens next to what it belongs to; on a phone, as a bottom sheet. */
export function PopoverContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        data-sheet=""
        className={cn(surfaceClasses, 'w-72 p-4', bottomSheetClasses, className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
