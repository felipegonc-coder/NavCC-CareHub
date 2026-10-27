// The page model's HTTP API as the sidebar uses it (decision 0007, section 4.1). Every path and
// response shape lives here, so a change on the server is a change in this file only.
import { api, ApiError } from '../../lib/api';
import type { MoveTo } from './move';
import type { PageLink, Space, TreeNode } from './types';

export const pagesKeys = {
  all: ['pages'] as const,
  spaces: ['pages', 'spaces'] as const,
  trees: ['pages', 'tree'] as const,
  tree: (spaceId: string) => ['pages', 'tree', spaceId] as const,
  shared: ['pages', 'shared'] as const,
  favorites: ['pages', 'favorites'] as const,
  recent: ['pages', 'recent'] as const,
  prefs: ['pages', 'prefs'] as const,
};

/** A list from a response that is either the list itself or `{ [field]: list }`. */
async function getList<T>(path: string, field: string): Promise<T[]> {
  const data: unknown = await api.get(path);
  if (Array.isArray(data)) return data as T[];
  const list = (data as Record<string, unknown> | null)?.[field];
  return Array.isArray(list) ? (list as T[]) : [];
}

export const fetchSpaces = () => getList<Space>('/api/spaces', 'spaces');
export const fetchTree = (spaceId: string) =>
  getList<TreeNode>(`/api/spaces/${spaceId}/tree`, 'nodes');
export const fetchShared = () => getList<TreeNode>('/api/shared', 'nodes');
export const fetchFavorites = () => getList<PageLink>('/api/favorites', 'favorites');
export const fetchRecent = () => getList<PageLink>('/api/recent', 'pages');
export const fetchPrefs = async () =>
  ((await api.get('/api/me/prefs')) ?? {}) as Record<string, unknown>;

/** Where a new page goes: the top of a space, or inside a page. */
export type NewPagePlace = { spaceId: string } | { parentId: string };
export const createPage = async (place: NewPagePlace) =>
  (await api.post('/api/pages', { kind: 'page', title: '', ...place })) as { id: string };
export const renamePage = (id: string, title: string) => api.patch(`/api/pages/${id}`, { title });
/** Moves the page, with everything in it, to Trash as one item with the page's ID. */
export const trashPage = (id: string) => api.delete(`/api/pages/${id}`);
/** Puts it back where it was, or at `to` when the person picks another place. */
export const restoreFromTrash = (id: string, to?: MoveTo) =>
  api.post(`/api/trash/${id}/restore`, to ?? {});
export const addFavorite = (pageId: string) => api.put('/api/favorites', { pageId });
export const removeFavorite = (pageId: string) => api.delete('/api/favorites', { pageId });
export const clearRecent = () => api.delete('/api/recent');

/** Without `confirmAccessChange`, a move that changes who can open the page is refused (409). */
export const movePage = (id: string, to: MoveTo, confirmAccessChange: boolean) =>
  api.post(`/api/pages/${id}/move`, confirmAccessChange ? { ...to, confirmAccessChange } : to);

/** Who would lose and who would get access, from a refused move. */
export interface AccessChange {
  losing: string[];
  gaining: string[];
}

const names = (list: unknown): string[] =>
  Array.isArray(list)
    ? list.flatMap((who: unknown) => {
        if (typeof who === 'string') return [who];
        const name = (who as { name?: unknown } | null)?.name;
        return typeof name === 'string' ? [name] : [];
      })
    : [];

/** The access change a move would make, when that's why the server refused it. */
export function accessChangeOf(error: unknown): AccessChange | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const details = (error as { details?: unknown }).details as Record<string, unknown> | undefined;
  return { losing: names(details?.losing), gaining: names(details?.gaining) };
}
export const savePref = (key: string, value: unknown) =>
  api.put(`/api/me/prefs/${encodeURIComponent(key)}`, { value });
