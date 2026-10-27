// Test helper: a fake versions API on `fetch`, with made-up versions of the page "Refund steps".
// People and pages are fictional.
import type {
  HistoryPerson,
  VersionListResponse,
  VersionPage,
  VersionResponse,
  VersionSummary,
} from '@carehub/extras/history';

export const PAGE_ID = 'page-refund-steps';
export const PAGE = { id: PAGE_ID, kind: 'page' as const, title: 'Refund steps' };
export const AVERY: HistoryPerson = { id: 'user-avery', name: 'Avery Lin' };
export const SAM: HistoryPerson = { id: 'user-sam', name: 'Sam Ortiz' };
export const TOO_OLD = 'This version is too old to show (deleted under the Data settings period).';

export interface FakeVersion {
  summary: VersionSummary;
  page: VersionPage;
}

const started = Date.now();

/** A version saved `minutesAgo` minutes before the test file loaded, holding one paragraph. */
export function fakeVersion(
  id: string,
  minutesAgo: number,
  text: string,
  overrides: Partial<VersionSummary> = {},
): FakeVersion {
  return {
    summary: {
      id,
      kind: 'automatic',
      name: null,
      createdAt: new Date(started - minutesAgo * 60_000).toISOString(),
      editors: [AVERY],
      createdBy: null,
      restoredFrom: null,
      ...overrides,
    },
    page: {
      title: 'Refund steps',
      icon: null,
      cover: null,
      style: {},
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    },
  };
}

export interface FakeHistoryOptions {
  /** Versions per page of the list. */
  pageSize?: number;
  canRestore?: boolean;
  /** Answers list requests with this error status. */
  listStatus?: number;
  /** Answers restores and names with this error. */
  changeError?: { status: number; message: string };
  /** Who restores and saves. */
  by?: HistoryPerson;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const refusal = (status: number) =>
  json(status, {
    error:
      status === 403
        ? { code: 'forbidden', message: "You don't have access to this." }
        : status === 404
          ? { code: 'not_found', message: 'This was deleted, or the link is wrong.' }
          : { code: 'unexpected', message: 'Something went wrong. Try again.' },
  });

/** Serves `versions` (newest first); change `state` to change what it answers next. */
export function fakeHistoryServer(versions: FakeVersion[], options: FakeHistoryOptions = {}) {
  const state = { versions, ...options };
  const requests: { method: string; url: string; body: unknown }[] = [];

  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init.method ?? 'GET';
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ method, url: `${url.pathname}${url.search}`, body });
    const match = /^\/api\/history\/pages\/[^/]+\/versions(?:\/([^/]+)(\/restore)?)?$/.exec(
      url.pathname,
    );
    if (!match) return refusal(404);
    const [, versionId, restore] = match;
    const by = state.by ?? AVERY;

    if (method !== 'GET' && state.changeError) {
      const { status, message } = state.changeError;
      const code = status === 409 ? 'conflict' : status === 404 ? 'not_found' : 'forbidden';
      return json(status, { error: { code, message } });
    }

    if (versionId === undefined && method === 'POST') {
      const { reason } = body as { reason: string };
      const saved = savedVersion(`v-before-${reason}`, `before_${reason}`, by, null);
      return json(201, { version: saved });
    }

    if (versionId === undefined) {
      if (state.listStatus) return refusal(state.listStatus);
      const before = url.searchParams.get('before');
      const start = before ? state.versions.findIndex((one) => one.summary.id === before) + 1 : 0;
      const size = state.pageSize ?? 50;
      const slice = state.versions.slice(start, start + size);
      const last = slice[slice.length - 1];
      const answer: VersionListResponse = {
        versions: slice.map((one) => one.summary),
        nextCursor: last && start + size < state.versions.length ? last.summary.id : null,
        canRestore: state.canRestore ?? true,
      };
      return json(200, answer);
    }

    const index = state.versions.findIndex((one) => one.summary.id === versionId);
    const found = state.versions[index];
    if (!found) return json(404, { error: { code: 'not_found', message: TOO_OLD } });

    if (restore && method === 'POST') {
      const saved = savedVersion('v-saved', 'before_restore', by, found.summary.createdAt);
      return json(200, { version: saved });
    }
    if (method === 'PATCH') {
      const { name } = body as { name: string | null };
      found.summary = { ...found.summary, name: name || null };
      return json(200, { version: found.summary });
    }
    const previous = state.versions[index + 1];
    const answer: VersionResponse = {
      version: found.summary,
      page: found.page,
      previous: previous ? { version: previous.summary, page: previous.page } : null,
      canRestore: state.canRestore ?? true,
    };
    return json(200, answer);
  };

  /** Adds the version a restore or the editor saves, newest first. */
  function savedVersion(
    id: string,
    kind: string,
    by: HistoryPerson,
    restoredFrom: string | null,
  ): VersionSummary {
    const saved = fakeVersion(id, 0, 'Call the member today.', {
      kind: kind as VersionSummary['kind'],
      editors: [],
      createdBy: by,
      restoredFrom,
    });
    state.versions = [saved, ...state.versions];
    return saved.summary;
  }

  return { fetch: fetch as typeof globalThis.fetch, requests, state };
}
