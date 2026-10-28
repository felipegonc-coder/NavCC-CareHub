import {
  SEARCH_TYPES,
  type SearchFilters,
  type SearchSort,
  type SearchType,
} from '@carehub/extras/search';

// The filter chips and sort (spec 2): what each says, and the filters the search API gets.

export const SORT_LABELS: Record<SearchSort, string> = {
  best: 'Best match',
  edited_desc: 'Edited, newest first',
  edited_asc: 'Edited, oldest first',
  created_desc: 'Created, newest first',
  created_asc: 'Created, oldest first',
};

export const TYPE_LABELS: Record<SearchType, string> = {
  page: 'Pages',
  database: 'Databases',
  row: 'Rows',
  file: 'Files',
};

/** Leaves out what's off or empty, so the request only has the filters that are on. */
export function cleanFilters(filters: SearchFilters): SearchFilters {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === false || (Array.isArray(value) && value.length === 0))
      continue;
    clean[key] = value;
  }
  return clean as SearchFilters;
}

export const hasFilters = (filters: SearchFilters) => Object.keys(cleanFilters(filters)).length > 0;

/** Adds the ID, or takes it out if it's there. */
export const toggled = (ids: readonly string[] | undefined, id: string) =>
  ids?.includes(id) ? ids.filter((other) => other !== id) : [...(ids ?? []), id];

/** "Type" or "Type: Pages, Rows". */
export function typeLabel(types: readonly SearchType[] | undefined): string {
  const on = SEARCH_TYPES.filter((type) => types?.includes(type));
  return on.length ? `Type: ${on.map((type) => TYPE_LABELS[type]).join(', ')}` : 'Type';
}
