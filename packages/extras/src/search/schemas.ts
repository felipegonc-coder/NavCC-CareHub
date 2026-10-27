// The search API's requests and answers (spec 4: text, filters, sort and a cursor; 20 at a time).
import { z } from 'zod';
import { SEARCH_TEXT_MAX } from './query';
import type { TextRange } from './snippet';

/** Results per request. */
export const SEARCH_PAGE_SIZE = 20;
/** Results are counted and ranked among at most this many matches. */
export const SEARCH_MAX_RESULTS = 1000;

export const SEARCH_TYPES = ['page', 'database', 'row', 'file'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];
export const SEARCH_SORTS = [
  'best',
  'edited_desc',
  'edited_asc',
  'created_desc',
  'created_asc',
] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];
/** `all`: every word must match (the search box). `any`: at least one word (the assistant panel). */
export const SEARCH_MATCHES = ['all', 'any'] as const;
export type SearchMatch = (typeof SEARCH_MATCHES)[number];

const idSchema = z.uuid({ error: "That ID isn't right." });
const idsSchema = z.array(idSchema).max(20, { error: 'Pick up to 20.' });
const whenSchema = z.iso.datetime({ offset: true, error: "That date isn't right." });

export const searchFiltersSchema = z
  .object({
    titleOnly: z.boolean().optional(),
    createdBy: idsSchema.optional(),
    editedBy: idsSchema.optional(),
    /** Spaces or pages, each with everything under it. */
    in: idsSchema.optional(),
    /** Today, Last 7 days and Last 30 days are sent as `from` in the person's time zone. */
    date: z
      .object({
        field: z.enum(['edited', 'created']),
        from: whenSchema.optional(),
        to: whenSchema.optional(),
      })
      .strict()
      .optional(),
    types: z.array(z.enum(SEARCH_TYPES)).max(SEARCH_TYPES.length).optional(),
    includeArchived: z.boolean().optional(),
  })
  .strict();
export type SearchFilters = z.infer<typeof searchFiltersSchema>;

/** POST /api/search/query */
export const searchRequestSchema = z
  .object({
    text: z.string().max(SEARCH_TEXT_MAX, { error: 'Search for up to 200 characters.' }),
    filters: searchFiltersSchema.default({}),
    sort: z.enum(SEARCH_SORTS).default('best'),
    /** With `any`, results with more of the words come first; the last word is never a beginning. */
    match: z.enum(SEARCH_MATCHES).default('all'),
    /** `nextCursor` from the answer before. */
    cursor: z
      .string()
      .regex(/^\d{1,4}$/, { error: "That cursor isn't right." })
      .optional(),
    /** Fewer results, for page pickers. */
    limit: z.number().int().min(1).max(SEARCH_PAGE_SIZE).optional(),
  })
  .strict();
export type SearchRequest = z.input<typeof searchRequestSchema>;

/** `{ type: 'emoji', emoji }` or `{ type: 'icon', name, color }` (decision 0007, section 4.1). */
export type SearchIcon =
  { type: 'emoji'; emoji: string } | { type: 'icon'; name: string; color?: string | null };

export interface SearchResult {
  id: string;
  kind: 'page' | 'database' | 'row';
  title: string;
  /** The words to show in bold. */
  titleRanges: TextRange[];
  icon: SearchIcon | null;
  /** The space, then the parent pages the person can open, top first. */
  path: string[];
  /** From the block with the most matching words. */
  snippet: { text: string; ranges: TextRange[] } | null;
  createdAt: string;
  editedAt: string;
  editedBy: { id: string; name: string } | null;
  /** For a row: its database's title. */
  rowIn: string | null;
  verified: boolean;
  archived: boolean;
}

export interface SearchResponse {
  results: SearchResult[];
  /** Matches the person can open, up to SEARCH_MAX_RESULTS. */
  total: number;
  nextCursor: string | null;
}
