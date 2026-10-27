// The page model's HTTP API as the sidebar uses it (decision 0007, section 4.1). Every path and
// response shape lives here, so a change on the server is a change in this file only.
import { api } from '../../lib/api';
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
export const trashPage = (id: string) => api.delete(`/api/pages/${id}`);
export const addFavorite = (pageId: string) => api.put('/api/favorites', { pageId });
export const removeFavorite = (pageId: string) => api.delete('/api/favorites', { pageId });
export const clearRecent = () => api.delete('/api/recent');
export const savePref = (key: string, value: unknown) =>
  api.put(`/api/me/prefs/${encodeURIComponent(key)}`, { value });
