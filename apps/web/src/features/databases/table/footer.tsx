import type { CSSProperties } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@carehub/ui';
import { AGGREGATES, type Aggregate, type Id, type Property, type View } from '@carehub/databases';
import { aggregateLabel, aggregatesFor, type ViewTotal } from '@carehub/databases/aggregate';
import type { TableColumn } from './columns';
import { TABLE_TEXT } from './messages';

export interface TotalsRowProps {
  columns: readonly TableColumn[];
  totals: Partial<Record<Id, ViewTotal>>;
  placeOf(column: TableColumn): CSSProperties;
  cellClass(column: TableColumn): string | undefined;
  /** Classes of an empty first cell, under the selection column (when rows can be ticked). */
  leadClass?: string;
  /** The view's calculations, with a Calculate menu in each cell (only with edit_views). */
  calculations?: View['calculations'];
  onCalculate?: (property: Property, aggregate: Aggregate) => void;
  testId?: string;
}

const isAggregate = (value: string): value is Aggregate =>
  (AGGREGATES as readonly string[]).includes(value);

/** A row of column totals: under each group, and at the bottom with a Calculate menu per column. */
export function TotalsRow({
  columns,
  totals,
  placeOf,
  cellClass,
  leadClass,
  calculations,
  onCalculate,
  testId,
}: TotalsRowProps) {
  return (
    <div role="row" data-testid={testId} className="group/totals flex border-b border-border">
      {leadClass !== undefined && <div role="gridcell" className={leadClass} />}
      {columns.map((column) => {
        const property = column.property;
        const total = totals[property.id];
        return (
          <div
            key={property.id}
            role="gridcell"
            data-property-id={property.id}
            style={placeOf(column)}
            className={cn(
              'flex min-h-9 shrink-0 items-center justify-end px-1 text-label text-muted',
              cellClass(column),
            )}
          >
            {calculations && onCalculate ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'flex min-h-8 min-w-0 items-center gap-1 rounded px-1 hover:bg-fill-hover max-md:min-h-11',
                      !total && 'opacity-0 focus:opacity-100 group-hover/totals:opacity-100',
                    )}
                  >
                    {total ? (
                      <span className="truncate">{total.text}</span>
                    ) : (
                      <>
                        {TABLE_TEXT.calculate}
                        <ChevronDown aria-hidden className="size-3" />
                      </>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-96 overflow-y-auto">
                  <DropdownMenuRadioGroup
                    value={calculations[property.id] ?? 'none'}
                    onValueChange={(value) => {
                      if (isAggregate(value)) onCalculate(property, value);
                    }}
                  >
                    {aggregatesFor(property).map((aggregate) => (
                      <DropdownMenuRadioItem key={aggregate} value={aggregate}>
                        {aggregateLabel(aggregate)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="truncate px-1">{total?.text}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
