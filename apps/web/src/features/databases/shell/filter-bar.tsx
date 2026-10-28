/**
 * The filter bar under the toolbar (spec 3.2): the view's sorts and filter as chips. Each chip
 * opens its panel under it: Sort, the Filter at the chip's rule, or the Filter's groups for
 * "Advanced filter".
 */
import { useEffect, useMemo, useRef } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@carehub/ui';
import { PANEL_LABELS, type PanelProps } from '../contract';
import { panelContext } from '../filters/types';
import { barChips, type BarChip } from './chips';
import { PanelBody, type Panels } from './panel-host';

type Shared = Omit<PanelProps, 'panel' | 'close' | 'target'>;

export interface FilterBarProps extends Shared {
  panels: Panels;
}

export function FilterBar({ panels, ...shared }: FilterBarProps) {
  const { meta, viewer, data, rowTitles } = shared;
  // Rules name the people and related rows that the view's answer names.
  const ctx = useMemo(() => {
    const people = Object.entries(data?.people ?? {}).map(([id, { name }]) => ({ id, name }));
    return panelContext({ meta, viewer, people, rowTitles });
  }, [meta, viewer, data?.people, rowTitles]);
  const chips = barChips(shared.view, ctx, shared.propertyIds);
  const gone = panels.chip !== null && !chips.some((chip) => chip.key === panels.chip);
  const { dismiss } = panels;
  useEffect(() => {
    // Its rule was removed, so the chip and its panel go.
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
        <PanelBody {...shared} panel={chip.panel} target={chip.target} close={panels.close} />
      </PopoverContent>
    </Popover>
  );
}

const ARROWS = { asc: ArrowUp, desc: ArrowDown } as const;
