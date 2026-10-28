import { buttonClasses, cn, Popover, PopoverContent, PopoverTrigger } from '@carehub/ui';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

// What the filter chips under the search box look like (spec 2).

export const chipClasses = (on: boolean) =>
  buttonClasses({
    variant: 'secondary',
    size: 'sm',
    className: cn('rounded-full', on && 'border-primary text-primary'),
  });

export const rowClasses =
  'flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-small max-md:min-h-11';

export function ToggleChip(props: { label: string; on: boolean; onToggle: (on: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={props.on}
      className={chipClasses(props.on)}
      onClick={() => props.onToggle(!props.on)}
    >
      {props.label}
    </button>
  );
}

export function ChipPopover(props: {
  chip: string;
  label: string;
  on: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    // Modal, so its list scrolls inside the search window.
    <Popover modal open={props.open} onOpenChange={props.onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className={chipClasses(props.on)}>
          {props.label}
          <ChevronDown aria-hidden className="text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={props.chip} align="start" className="p-1">
        {props.children}
      </PopoverContent>
    </Popover>
  );
}
