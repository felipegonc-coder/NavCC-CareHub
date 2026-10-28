import {
  SEARCH_SORTS,
  SEARCH_TYPES,
  type SearchFilters,
  type SearchSort,
  type SearchType,
} from '@carehub/extras/search';
import {
  Button,
  buttonClasses,
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Input,
} from '@carehub/ui';
import { ArrowUpDown, Check, ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { ChipPopover, chipClasses, rowClasses, ToggleChip } from './Chip';
import {
  cleanFilters,
  DATE_PRESETS,
  dateLabel,
  dayField,
  dayStart,
  fieldDay,
  hasFilters,
  SORT_LABELS,
  toggled,
  TYPE_LABELS,
  typeLabel,
  type Names,
} from './filters';
import { InChip, PeopleChip } from './Pickers';

/** What the window searches with, besides the text. */
export interface SearchOptions {
  filters: SearchFilters;
  sort: SearchSort;
  names: Names;
}

/**
 * The chips under the search box (spec 2): Title only, In, Created by, Edited by, Date, Type and
 * Include archived, then Clear filters once one is on, and Sort. Tab reaches each of them.
 */
export function FilterBar({
  options,
  onChange,
  onClear,
}: {
  options: SearchOptions;
  onChange: (options: SearchOptions) => void;
  onClear: () => void;
}) {
  const { filters, sort, names } = options;
  const set = (change: Partial<SearchFilters>, more: Names = {}) =>
    onChange({
      ...options,
      filters: cleanFilters({ ...filters, ...change }),
      names: { ...names, ...more },
    });
  return (
    <div
      role="group"
      aria-label="Filters"
      className="flex items-center gap-2 overflow-x-auto border-b px-4 py-2 md:flex-wrap"
    >
      <ToggleChip
        label="Title only"
        on={!!filters.titleOnly}
        onToggle={(on) => set({ titleOnly: on })}
      />
      <InChip ids={filters.in} names={names} onChange={(ids, more) => set({ in: ids }, more)} />
      <PeopleChip
        role="created"
        ids={filters.createdBy}
        names={names}
        onChange={(ids, more) => set({ createdBy: ids }, more)}
      />
      <PeopleChip
        role="edited"
        ids={filters.editedBy}
        names={names}
        onChange={(ids, more) => set({ editedBy: ids }, more)}
      />
      <DateChip date={filters.date} onChange={(date) => set({ date })} />
      <TypeChip types={filters.types} onChange={(types) => set({ types })} />
      <ToggleChip
        label="Include archived"
        on={!!filters.includeArchived}
        onToggle={(on) => set({ includeArchived: on })}
      />
      {hasFilters(filters) && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      )}
      <SortMenu sort={sort} onSort={(next) => onChange({ ...options, sort: next })} />
    </div>
  );
}

type DateFilter = NonNullable<SearchFilters['date']>;

/** Date: Edited or Created; Today, Last 7 days, Last 30 days, or a range. */
function DateChip(props: {
  date: SearchFilters['date'];
  onChange: (date: SearchFilters['date']) => void;
}) {
  const { date, onChange } = props;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<DateFilter['field']>('edited');
  const field = date?.field ?? chosen;
  const now = new Date();
  const pick = (from?: string, to?: string) =>
    onChange(from || to ? { field, ...(from && { from }), ...(to && { to }) } : undefined);
  return (
    <ChipPopover
      chip="Date"
      label={dateLabel(date, now)}
      on={!!date}
      open={open}
      onOpenChange={setOpen}
    >
      <div className="flex flex-col gap-2 p-1">
        <div role="group" aria-label="Which date" className="flex gap-1">
          {(['edited', 'created'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={field === value ? 'secondary' : 'ghost'}
              aria-pressed={field === value}
              onClick={() => {
                setChosen(value);
                if (date) onChange({ ...date, field: value });
              }}
            >
              {value === 'edited' ? 'Edited' : 'Created'}
            </Button>
          ))}
        </div>
        <div className="flex flex-col">
          {DATE_PRESETS.map(({ label, days }) => {
            const from = dayStart(now, days);
            const on = !!date && !date.to && date.from === from;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                className={cn(rowClasses, 'hover:bg-fill-hover')}
                onClick={() => (on ? pick() : pick(from))}
              >
                <Check aria-hidden className={cn('size-4 text-primary', !on && 'invisible')} />
                {label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-from`} className="text-label text-muted">
              From
            </label>
            <Input
              id={`${id}-from`}
              type="date"
              value={dayField(date?.from)}
              onChange={(event: { target: HTMLInputElement }) =>
                pick(fieldDay(event.target.value), date?.to)
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-to`} className="text-label text-muted">
              To
            </label>
            <Input
              id={`${id}-to`}
              type="date"
              value={dayField(date?.to, true)}
              onChange={(event: { target: HTMLInputElement }) =>
                pick(date?.from, fieldDay(event.target.value, true))
              }
            />
          </div>
        </div>
      </div>
    </ChipPopover>
  );
}

/** Type: Pages, Databases, Rows and Files, as many as wanted. */
function TypeChip(props: {
  types: SearchType[] | undefined;
  onChange: (types: SearchType[]) => void;
}) {
  const types = props.types ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={chipClasses(types.length > 0)}>
          {typeLabel(types)}
          <ChevronDown aria-hidden className="text-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {SEARCH_TYPES.map((type) => (
          <DropdownMenuCheckboxItem
            key={type}
            checked={types.includes(type)}
            onCheckedChange={() => props.onChange(toggled(types, type) as SearchType[])}
            // Stays open, to pick more than one.
            onSelect={(event: Event) => event.preventDefault()}
          >
            {TYPE_LABELS[type]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Sort: Best match, or Edited or Created, newest or oldest first. */
function SortMenu(props: { sort: SearchSort; onSort: (sort: SearchSort) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Sort: ${SORT_LABELS[props.sort]}`}
          className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'ml-auto' })}
        >
          <ArrowUpDown aria-hidden />
          {SORT_LABELS[props.sort]}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={props.sort}
          onValueChange={(value: string) => props.onSort(value as SearchSort)}
        >
          {SEARCH_SORTS.map((sort) => (
            <DropdownMenuRadioItem key={sort} value={sort}>
              {SORT_LABELS[sort]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
