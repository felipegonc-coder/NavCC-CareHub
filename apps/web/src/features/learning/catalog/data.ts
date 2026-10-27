import { CourseTypeSchema, IdSchema, ImageSchema, searchCatalog } from '@carehub/learning';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../data';
import { retryOnce } from '../player/data';

// GET /catalog (docs/learning/api.md): the live, listed courses anyone in the workspace can take.

// A stand-in until B1's CatalogEntrySchema (#118) reaches main; then this becomes that import.
const CatalogEntrySchema = z.object({
  id: IdSchema,
  title: z.string(),
  type: CourseTypeSchema,
  summary: z.string().optional(),
  cover: ImageSchema.optional(),
  topics: z.array(z.string()).optional(),
  estimatedMinutes: z.number().int().optional(),
  lessonCount: z.number().int().min(0),
  version: z.number().int().min(1),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

const CatalogReply = z.array(CatalogEntrySchema);

export const catalogKey = ['learning', 'catalog'] as const;

/** Every course in the catalog, in the server's order. Screens search it in the browser. */
export function useCatalog() {
  return useQuery({
    queryKey: catalogKey,
    queryFn: ({ signal }) => api('GET', '/catalog', CatalogReply, { signal }),
    retry: retryOnce,
  });
}

/** The entries that match a search (`searchCatalog`: every word, ignoring case and accents). */
export function findCourses(
  entries: readonly CatalogEntry[],
  query: string,
  topic?: string,
): CatalogEntry[] {
  const listed = entries.map((entry) => ({ ...entry, settings: { catalog: { listed: true } } }));
  return searchCatalog(listed, query, topic);
}

/** Every topic in the catalog once, in alphabetical order. */
export function catalogTopics(entries: readonly CatalogEntry[]): string[] {
  const topics = new Set(entries.flatMap((entry) => entry.topics ?? []));
  return [...topics].sort((a, b) => a.localeCompare(b));
}
