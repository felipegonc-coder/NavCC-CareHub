/**
 * The filter bar under the toolbar (spec 3.2): the view's sorts and filter as chips. Each chip
 * opens its panel under it: Sort, one condition of the Filter, or the whole filter for "Advanced
 * filter".
 */
import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@carehub/ui';
import { PANEL_LABELS, type PanelProps } from '../contract';
import type { FilterNames } from '../filter-text';
import { barChips, type BarChip } from './chips';
import { PanelBody, type Panels } from './panel-host';

type Shared = Omit<PanelProps, 'panel' | 'close' | 'conditionId'>;

export interface FilterBarProps extends Shared {
  panels: Panels;
  /** People's names and related rows' titles from the view's answer. */
  names: FilterNames;
}

export function FilterBar({ panels, names, ...shared }: FilterBarProps) {
  const chips = barChips(shared.view, shared.meta.properties, names);
  const gone = panels.chip !== null && !chips.some((chip) => chip.key === panels.chip);
  const { dismiss } = panels;
  useEffect(() => {
    // Its condition was removed, so the chip and its panel go.
    if (gone) dismiss();
  }, [gone, dismiss]);

  if (chips.length === 0) return null;
  return (
    <div role="group" aria-label="Filter bar" className="flex flex-wrap items-center gap-1">
      {chips.map((chip) => (
        <Chip key={chip.key} chip={chip} panels={panels} shared={shared} />
      ))}
    </div>
  );
}

function Chip({ chip, panels, shared }: { chip: BarChip; panels: Panels; shared: Shared }) {
  const button = useRef<HTMLButtonElement | null>(null);
  const open = panels.chip === chip.key && panels.open === chip.panel;
  const Arrow =
    chip.panel !== 'sort' ? null : chip.direction ? ARROWS[chip.direction] : ArrowUpDown;
  return (
    <Popover
      open={open}
      onOpenChange={(next) =>
        next ? panels.show(chip.panel, button.current, chip.key) : panels.dismiss()
      }
    >
      <PopoverTrigger asChild>
        <Button
          ref={button}
          size="sm"
          variant="secondary"
          aria-label={chip.label}
          className="max-w-64 rounded-full"
        >
          {Arrow && <Arrow aria-hidden />}
          <span className="truncate">{chip.text}</span>
          <ChevronDown aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={PANEL_LABELS[chip.panel]}
        className="w-auto max-w-dialog"
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          panels.close();
        }}
        onCloseAutoFocus={panels.closeAutoFocus}
      >
        <PanelBody
          {...shared}
          panel={chip.panel}
          conditionId={chip.conditionId}
          close={panels.close}
        />
      </PopoverContent>
    </Popover>
  );
}

const ARROWS = { asc: ArrowUp, desc: ArrowDown } as const;
