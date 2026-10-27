/** The address of a page, database or row: `/p/<pageId>`. */
export function pageUrl(id: string): string {
  return `/p/${encodeURIComponent(id)}`;
}
