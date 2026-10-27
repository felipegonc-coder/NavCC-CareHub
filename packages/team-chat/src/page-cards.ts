import { z } from 'zod';
import { listNames } from './names';

/** A page card's data, as the pages feature's `GET /api/pages/:id/card` returns it. */
export const pageCardDataSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
  spaceName: z.string(),
});
export type PageCardData = z.infer<typeof pageCardDataSchema>;

/** One viewer's card: locked and deleted cards carry only the page ID, never its title. */
export const viewerPageCardSchema = z.discriminatedUnion('state', [
  pageCardDataSchema.extend({ state: z.literal('open') }),
  z.object({ id: z.string(), state: z.literal('locked') }),
  z.object({ id: z.string(), state: z.literal('deleted') }),
]);
export type ViewerPageCard = z.infer<typeof viewerPageCardSchema>;

/**
 * Builds the card for one viewer (MS-03). Pass `page: null` once the page is deleted (the card
 * API's 404). A viewer who can't open the page (the card API's 403) gets "🔒 A page you can't
 * open" and nothing else.
 */
export function viewerPageCard(
  id: string,
  page: PageCardData | null,
  canOpen: boolean,
): ViewerPageCard {
  if (!page) return { id, state: 'deleted' };
  if (!canOpen) return { id, state: 'locked' };
  const { kind, title, icon, spaceName } = page;
  return { id, state: 'open', kind, title, icon, spaceName };
}

/** Before sending: "Sam Ortiz can't open 'Coaching plan – Q4'." */
export function cantOpenWarning(pageTitle: string, names: readonly string[]): string {
  return `${listNames(names)} can't open '${pageTitle}'.`;
}
