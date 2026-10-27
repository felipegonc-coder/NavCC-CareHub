// The versions and Updates API (/api/history/pages/:pageId/…). The server checks access on every
// call (HT-15); these only send the requests.
import type {
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
