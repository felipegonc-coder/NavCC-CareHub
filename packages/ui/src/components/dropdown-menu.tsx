import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { bottomSheetClasses, menuItemClasses, surfaceClasses } from './classes';

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;
/** A second menu inside a menu: `DropdownMenuSubTrigger` and `DropdownMenuSubContent`. */
export const DropdownMenuSub = MenuPrimitive.Sub;

/** Opens next to its button; on a phone, as a bottom sheet. */
export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        data-sheet=""
        className={cn(surfaceClasses, 'min-w-44', bottomSheetClasses, className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export interface DropdownMenuItemProps extends ComponentProps<typeof MenuPrimitive.Item> {
  /** 'danger' for actions such as delete. */
  variant?: 'default' | 'danger';
}

export function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: DropdownMenuItemProps) {
  return (
    <MenuPrimitive.Item
      className={cn(menuItemClasses, variant === 'danger' && 'text-danger', className)}
      {...props}
    />
  );
}

function ItemCheck() {
  return (
    <span className="absolute left-2 inline-flex">
      <MenuPrimitive.ItemIndicator>
        <Check aria-hidden />
      </MenuPrimitive.ItemIndicator>
    </span>
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem className={cn(menuItemClasses, 'pl-8', className)} {...props}>
      <ItemCheck />
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem className={cn(menuItemClasses, 'pl-8', className)} {...props}>
      <ItemCheck />
      {children}
    </MenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn('px-2 py-1.5 text-label font-medium text-muted', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
  );
}

/** The row that opens a second menu: on hover, on a click or tap, and with the right arrow key. */
export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.SubTrigger>) {
  return (
    <MenuPrimitive.SubTrigger
      className={cn(menuItemClasses, 'data-[state=open]:bg-fill-hover', className)}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden className="ml-auto" />
    </MenuPrimitive.SubTrigger>
  );
}

/**
 * The second menu, beside its row; the left arrow key closes it. On a phone it opens as a sheet
 * over the first menu without dimming it again, so the first menu's rows stay tappable.
 */
export function DropdownMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.SubContent>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.SubContent
        data-sheet="stacked"
        className={cn(surfaceClasses, 'min-w-44', bottomSheetClasses, className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}
