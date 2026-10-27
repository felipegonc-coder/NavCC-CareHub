// The page model's HTTP API as the sidebar uses it (decision 0007, section 4.1). Every path and
// response shape lives here, so a change on the server is a change in this file only.
import type { AccessLevel } from '@carehub/shared';
import { api, ApiError } from '../../lib/api';
import type { MoveTo } from './move';
import { settingsOf, type SpaceChange, type SpaceSettings } from './space-settings';
import type {
  BrowseSpace,
  PageIcon,
  PageLink,
  Space,
  SpaceAccess,
  SpaceKind,
  TreeNode,
} from './types';

export const pagesKeys = {
  all: ['pages'] as const,
  spaces: ['pages', 'spaces'] as const,
  trees: ['pages', 'tree'] as const,
  tree: (spaceId: string) => ['pages', 'tree', spaceId] as const,
  shared: ['pages', 'shared'] as const,
  favorites: ['pages', 'favorites'] as const,
  recent: ['pages', 'recent'] as const,
  prefs: ['pages', 'prefs'] as const,
  trash: ['pages', 'trash'] as const,
  page: (id: string) => ['pages', 'page', id] as const,
  space: (id: string) => ['pages', 'space', id] as const,
  browse: ['pages', 'browse'] as const,
  members: (spaceId: string) => ['pages', 'space', spaceId, 'members'] as const,
  people: (query: string) => ['pages', 'people', query] as const,
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

/** A team space to make; the person making it becomes an owner (Sidebar spec, section 3.3). */
export interface NewSpace {
  name: string;
  icon: PageIcon | null;
  description: string;
  kind: SpaceKind;
  defaultAccess: SpaceAccess;
}
/** Space names are unique in the workspace (409 otherwise) and up to 60 characters. */
export const SPACE_NAME_MAX = 60;
export const createSpace = (space: NewSpace) => api.post('/api/spaces', space);
/** The last owner can't leave (409) until someone else is an owner. */
export const leaveSpace = (id: string) => api.post(`/api/spaces/${id}/leave`);
/** It leaves every sidebar and its pages turn read-only; Admins can unarchive it. */
export const archiveSpace = (id: string) => api.patch(`/api/spaces/${id}`, { archived: true });
/** Moves the space and all its pages to Trash. */
export const deleteSpace = (id: string) => api.delete(`/api/spaces/${id}`);

/** A space's settings; null when the reply has no space. */
export const fetchSpaceSettings = async (id: string): Promise<SpaceSettings | null> =>
  settingsOf(await api.get(`/api/spaces/${id}`));
/** Changes some of a space's settings; a name another space has is refused (409). */
export const changeSpace = (id: string, change: SpaceChange) =>
  api.patch(`/api/spaces/${id}`, change);

/** Someone in a space: a person or a group, as an owner or a member. */
export interface SpaceMember {
  /** The person's or the group's ID. */
  id: string;
  type: 'user' | 'group';
  name: string;
  email?: string | undefined;
  avatarUrl?: string | undefined;
  role: SpaceRole;
}
export type SpaceRole = 'owner' | 'member';

/** Someone asking to join a Closed space. */
export interface JoinRequest {
  id: string;
  user: { id: string; name: string; email?: string | undefined; avatarUrl?: string | undefined };
  requestedAt: string;
}

export interface SpaceMembers {
  members: SpaceMember[];
  requests: JoinRequest[];
}

export async function fetchSpaceMembers(spaceId: string): Promise<SpaceMembers> {
  const data = (await api.get(`/api/spaces/${spaceId}/members`)) as Partial<SpaceMembers> | null;
  return {
    members: Array.isArray(data?.members) ? data.members : [],
    requests: Array.isArray(data?.requests) ? data.requests : [],
  };
}
export const addSpaceMember = (
  spaceId: string,
  who: { type: SpaceMember['type']; id: string },
  role: SpaceRole,
) => api.post(`/api/spaces/${spaceId}/members`, { ...who, role });
/** A space always keeps an owner: taking away the last one is refused (409). */
export const setSpaceRole = (spaceId: string, memberId: string, role: SpaceRole) =>
  api.patch(`/api/spaces/${spaceId}/members/${memberId}`, { role });
export const removeSpaceMember = (spaceId: string, memberId: string) =>
  api.delete(`/api/spaces/${spaceId}/members/${memberId}`);
export const answerJoinRequest = (spaceId: string, requestId: string, approve: boolean) =>
  api.post(`/api/spaces/${spaceId}/requests/${requestId}`, { approve });

/** A person or group that could join a space. Guests can't (Sidebar spec, section 3.3). */
export interface Candidate {
  type: SpaceMember['type'];
  id: string;
  name: string;
  email?: string | undefined;
  avatarUrl?: string | undefined;
  isGuest?: boolean | undefined;
  /** How many people a group has. */
  size?: number | undefined;
}

type Person = Omit<Candidate, 'type' | 'size'>;
type Group = { id: string; name: string; memberIds?: string[] | undefined };

/** People from accounts that match, then groups whose name does (decision 0007, 4.1 and 4.3). */
export async function findCandidates(query: string): Promise<Candidate[]> {
  const [people, groups] = await Promise.all([
    getList<Person>(`/api/workspace/members?q=${encodeURIComponent(query)}`, 'members'),
    getList<Group>('/api/workspace/groups', 'groups').catch((): Group[] => []),
  ]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const named = groups.filter((group) =>
    words.every((word) => group.name.toLowerCase().includes(word)),
  );
  return [
    ...people.map((person): Candidate => ({ ...person, type: 'user' })),
    ...named.map((group): Candidate => ({
      type: 'group',
      id: group.id,
      name: group.name,
      size: group.memberIds?.length,
    })),
  ];
}

/** Every Open and Closed space in the workspace, for Browse spaces. */
export const fetchBrowseSpaces = () => getList<BrowseSpace>('/api/spaces/browse', 'spaces');
/** Joins an Open space, or asks a Closed space's owners to let the person in. */
export async function joinSpace(id: string): Promise<'member' | 'requested'> {
  const data = (await api.post(`/api/spaces/${id}/join`)) as { status?: unknown } | null;
  return data?.status === 'requested' ? 'requested' : 'member';
}

/** How many pages the space holds, for the Delete space confirm; null when the server doesn't say. */
export async function fetchPageCount(spaceId: string): Promise<number | null> {
  type Reply = { space?: { pageCount?: unknown }; pageCount?: unknown } | null;
  const data = (await api.get(`/api/spaces/${spaceId}`)) as Reply;
  const count = data?.space?.pageCount ?? data?.pageCount;
  return typeof count === 'number' ? count : null;
}

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

/** Something in Trash, with everything that went with it (Page history and Trash, 3.4). */
export interface TrashItem {
  /** The page, database, row or space; restoring and deleting forever use it. */
  id: string;
  kind: 'page' | 'database' | 'row' | 'space';
  title: string;
  icon: PageIcon | null;
  /** Where it was, space first, such as ["Support", "Policies"]. */
  path: string[];
  /** How many sub-pages, databases and rows went with it. */
  inside: number;
  deletedBy: { id: string; name: string } | null;
  deletedAt: string;
  /** When it goes for good. */
  deletesAt: string;
  /** Deleting forever needs Full access on it when it was deleted. */
  canDelete: boolean;
}

export interface TrashList {
  items: TrashItem[];
  /** How many days things stay in Trash (Data settings). */
  retentionDays: number;
}

export async function fetchTrash(): Promise<TrashList> {
  const data: unknown = await api.get('/api/trash');
  const list = data as Partial<TrashList> | null;
  return {
    items: Array.isArray(data) ? (data as TrashItem[]) : (list?.items ?? []),
    retentionDays: list?.retentionDays ?? 30,
  };
}

export const deleteForever = (id: string) => api.delete(`/api/trash/${id}`);

/** The parent that is in Trash too, when that's why a restore was refused (409). */
export function parentInTrash(error: unknown): { id: string; title: string } | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const details = (error as { details?: unknown }).details as { parent?: unknown } | undefined;
  const parent = details?.parent as { id?: unknown; title?: unknown } | undefined;
  if (typeof parent?.id !== 'string') return null;
  return { id: parent.id, title: typeof parent.title === 'string' ? parent.title : '' };
}

/** A picture from Care Hub's cover gallery, or an uploaded one (decision 0007, section 4.1). */
export type PageCover = { type: 'preset'; name: string } | { type: 'file'; fileId: string };

/** Who did something to a page, and when. */
export interface Stamp {
  by: { id: string; name: string } | null;
  at: string;
}

/** A step of the breadcrumbs: the space, then each page above this one. */
export interface Crumb {
  id: string;
  kind: 'space' | 'page' | 'database' | 'row';
  title: string;
  icon: PageIcon | null;
}

/** A page as its screen shows it (Pages and blocks, sections 2 and 4). */
export interface PageDetail {
  id: string;
  kind: 'page' | 'database' | 'row';
  spaceId: string;
  parentId: string | null;
  title: string;
  icon: PageIcon | null;
  cover: PageCover | null;
  /** Which part of the cover shows, from 0 (its top) to 100 (its bottom). */
  coverPosition: number;
  fullWidth: boolean;
  access: AccessLevel;
  /** Where it lives, space first; the page itself isn't in it. */
  path: Crumb[];
  created: Stamp | null;
  edited: Stamp | null;
  locked: Stamp | null;
  archived: Stamp | null;
  /** Set when the page is in Trash. */
  deleted: Stamp | null;
}

/** What a page's screen may change, with PATCH /api/pages/:id. */
export type PageChange = Partial<
  Pick<PageDetail, 'title' | 'icon' | 'cover' | 'coverPosition' | 'fullWidth'> & {
    locked: boolean;
    archived: boolean;
  }
>;

function stampOf(data: Record<string, unknown>, name: string): Stamp | null {
  const at = data[`${name}At`];
  if (typeof at !== 'string') return null;
  const by = data[`${name}By`] as { id?: unknown; name?: unknown } | null | undefined;
  return {
    at,
    by:
      typeof by?.id === 'string'
        ? { id: by.id, name: typeof by.name === 'string' ? by.name : '' }
        : null,
  };
}

/** The page from GET /api/pages/:id, which sends it alone or as `{ page }`. */
export function toPageDetail(body: unknown): PageDetail {
  const outer = (body ?? {}) as { page?: unknown };
  const data = (outer.page ?? outer) as Record<string, unknown> & Partial<PageDetail>;
  return {
    id: String(data.id),
    kind: data.kind ?? 'page',
    spaceId: String(data.spaceId),
    parentId: data.parentId ?? null,
    title: typeof data.title === 'string' ? data.title : '',
    icon: data.icon ?? null,
    cover: data.cover ?? null,
    coverPosition: typeof data.coverPosition === 'number' ? data.coverPosition : 50,
    fullWidth: data.fullWidth === true,
    access: data.access ?? 'view',
    path: Array.isArray(data.path) ? data.path : [],
    created: stampOf(data, 'created'),
    edited: stampOf(data, 'updated'),
    locked: stampOf(data, 'locked'),
    archived: stampOf(data, 'archived'),
    deleted: stampOf(data, 'deleted'),
  };
}

export const fetchPage = async (id: string) => toPageDetail(await api.get(`/api/pages/${id}`));
export const changePage = (id: string, change: PageChange) => api.patch(`/api/pages/${id}`, change);
