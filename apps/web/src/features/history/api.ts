// The versions, Updates and archive API (/api/history/pages/:pageId/…). The server checks access
// on every call (HT-15); these only send the requests.
import type {
  ArchiveChange,
  ArchiveState,
  SavedVersionResponse,
  UpdateListResponse,
  VersionListResponse,
  VersionResponse,
  VersionSummary,
} from '@carehub/extras/history';
import { api, ApiError } from '../../lib/api';

const versionsPath = (pageId: string) =>
  `/api/history/pages/${encodeURIComponent(pageId)}/versions`;
const versionPath = (pageId: string, versionId: string) =>
  `${versionsPath(pageId)}/${encodeURIComponent(versionId)}`;

export const historyKeys = {
  all: ['history'] as const,
  list: (pageId: string) => ['history', pageId, 'versions'] as const,
  version: (pageId: string, versionId: string) =>
    ['history', pageId, 'version', versionId] as const,
  updates: (pageId: string) => ['history', pageId, 'updates'] as const,
  /** Every page's archive state: archiving one page changes its sub-pages too. */
  archives: ['history', 'archive'] as const,
  archive: (pageId: string) => ['history', 'archive', pageId] as const,
};

/** One page of versions, newest first; `before` is the previous page's `nextCursor`. */
export function listVersions(
  pageId: string,
  before: string | null,
  signal?: AbortSignal,
): Promise<VersionListResponse> {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  return api.get<VersionListResponse>(`${versionsPath(pageId)}${query}`, { signal });
}

/** One page of the page's Updates, newest first; `before` is the previous page's `nextCursor`. */
export function listUpdates(
  pageId: string,
  before: string | null,
  signal?: AbortSignal,
): Promise<UpdateListResponse> {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  const path = `/api/history/pages/${encodeURIComponent(pageId)}/updates${query}`;
  return api.get<UpdateListResponse>(path, { signal });
}

/** Who archived the page and when, and whether the person may archive or unarchive it. */
export function getArchive(pageId: string, signal?: AbortSignal): Promise<ArchiveState> {
  return api.get<ArchiveState>(`/api/history/pages/${encodeURIComponent(pageId)}/archive`, {
    signal,
  });
}

/** Archives the page with its sub-pages, or unarchives the page it was archived with. */
export function changeArchive(pageId: string, archive: boolean): Promise<ArchiveChange> {
  const action = archive ? 'archive' : 'unarchive';
  return api.post<ArchiveChange>(`/api/history/pages/${encodeURIComponent(pageId)}/${action}`);
}

/** A version's page, with the one before it for Show changes. */
export function getVersion(
  pageId: string,
  versionId: string,
  signal?: AbortSignal,
): Promise<VersionResponse> {
  return api.get<VersionResponse>(versionPath(pageId, versionId), { signal });
}

/** Names or renames a version; null removes its name. */
export function nameVersion(
  pageId: string,
  versionId: string,
  name: string | null,
): Promise<SavedVersionResponse> {
  return api.patch<SavedVersionResponse>(versionPath(pageId, versionId), { name });
}

/** Restores a version; the answer is the version saved just before (HT-05). */
export function restoreVersion(pageId: string, versionId: string): Promise<SavedVersionResponse> {
  return api.post<SavedVersionResponse>(`${versionPath(pageId, versionId)}/restore`);
}

/**
 * Saves a version right before the editor's Replace all or Accept all suggestions changes the
 * page (HT-02): wait for it, then make the change. Null when the page keeps no versions (404);
 * when it throws, leave the page as it is.
 */
export async function saveVersionBefore(
  pageId: string,
  reason: 'replace' | 'accept_all',
): Promise<VersionSummary | null> {
  try {
    const { version } = await api.post<SavedVersionResponse>(versionsPath(pageId), { reason });
    return version;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** The link Copy link gives: the page, opening Version history on this version. */
export function versionLink(pageId: string, versionId: string): string {
  const page = encodeURIComponent(pageId);
  return `${window.location.origin}/p/${page}?version=${encodeURIComponent(versionId)}`;
}
