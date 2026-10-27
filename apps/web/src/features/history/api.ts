// The versions API (/api/history/pages/:pageId/versions). The server checks access on every call
// (HT-15); these only send the requests.
import type { VersionListResponse, VersionResponse } from '@carehub/extras/history';
import { api } from '../../lib/api';

const versionsPath = (pageId: string) =>
  `/api/history/pages/${encodeURIComponent(pageId)}/versions`;
const versionPath = (pageId: string, versionId: string) =>
  `${versionsPath(pageId)}/${encodeURIComponent(versionId)}`;

export const historyKeys = {
  all: ['history'] as const,
  list: (pageId: string) => ['history', pageId, 'versions'] as const,
  version: (pageId: string, versionId: string) =>
    ['history', pageId, 'version', versionId] as const,
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

/** A version's page, with the one before it for Show changes. */
export function getVersion(
  pageId: string,
  versionId: string,
  signal?: AbortSignal,
): Promise<VersionResponse> {
  return api.get<VersionResponse>(versionPath(pageId, versionId), { signal });
}

/** The link Copy link gives: the page, opening Version history on this version. */
export function versionLink(pageId: string, versionId: string): string {
  const page = encodeURIComponent(pageId);
  return `${window.location.origin}/p/${page}?version=${encodeURIComponent(versionId)}`;
}
