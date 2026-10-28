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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@carehub/ui';
import { ArrowUpDown, ChevronDown } from 'lucide-react';
import { chipClasses, ToggleChip } from './Chip';
import { cleanFilters, hasFilters, SORT_LABELS, toggled, TYPE_LABELS, typeLabel } from './filters';

/** What the window searches with, besides the text. */
export interface SearchOptions {
  filters: SearchFilters;
  sort: SearchSort;
}

/**
 * The chips under the search box (spec 2): Title only, Type and Include archived, then Clear filters
 * once one is on, and Sort. Tab reaches each of them.
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
  const { filters, sort } = options;
  const set = (change: Partial<SearchFilters>) =>
    onChange({ ...options, filters: cleanFilters({ ...filters, ...change }) });
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
