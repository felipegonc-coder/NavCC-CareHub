// Where the gallery was opened from (spec 2): the sidebar, "Templates" on a new empty page (the
// template goes into that page) or New page ▾ → From template (a new sub-page there). The page
// travels in the address, so Back and reloads keep it; its title comes along in the history state.

export const GALLERY_PATH = '/templates';

/** "apply": put the template into this empty page; "page": make a sub-page of it. */
export type GalleryOrigin = { pageId: string; mode: 'apply' | 'page' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The gallery's address, opened from a page or from the sidebar. */
export function galleryUrl(origin?: GalleryOrigin): string {
  if (!origin) return GALLERY_PATH;
  return `${GALLERY_PATH}?${new URLSearchParams({ to: origin.pageId, mode: origin.mode })}`;
}

/** The page the gallery was opened from, if the address names one. */
export function readOrigin(params: URLSearchParams): GalleryOrigin | null {
  const pageId = params.get('to');
  if (!pageId || !UUID.test(pageId)) return null;
  return { pageId, mode: params.get('mode') === 'apply' ? 'apply' : 'page' };
}

/** The title the opener passed in the history state (`{ title }`), if any. */
export function originTitle(state: unknown): string | null {
  if (!state || typeof state !== 'object' || !('title' in state)) return null;
  const { title } = state as { title: unknown };
  return typeof title === 'string' && title.trim() ? title.trim() : null;
}
