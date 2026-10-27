// Test helper: a fake comments API for one page, on top of fetch. The signed-in person is Sam.
import type {
  CommentPerson,
  CommentsResponse,
  CommentThreadView,
  CommentView,
  CreateCommentResponse,
} from '@carehub/shared';

export const PAGE_ID = '8f6f2a8e-1d3b-4b7e-9a51-3c2d4e5f6a7b';
export const THREAD_ID = '5b1d9c0e-7f2a-4c3b-8d4e-6f7a8b9c0d1e';

export const PEOPLE: Record<string, CommentPerson> = {
  avery: { id: 'avery', name: 'Avery Lin', avatarUrl: null },
  sam: { id: 'sam', name: 'Sam Ortiz', avatarUrl: null },
};

export function comment(overrides: Partial<CommentView> = {}): CommentView {
  return {
    id: 'comment-1',
    authorId: 'avery',
    text: 'Can we move the home visit to Thursday?',
    createdAt: '2026-10-27T09:00:00.000Z',
    editedAt: null,
    deleted: false,
    canEdit: false,
    canDelete: false,
    ...overrides,
  };
}

export function thread(overrides: Partial<CommentThreadView> = {}): CommentThreadView {
  return {
    id: THREAD_ID,
    pageId: PAGE_ID,
    spot: 'page',
    blockId: null,
    propertyId: null,
    quote: null,
    createdBy: 'avery',
    createdAt: '2026-10-27T09:00:00.000Z',
    lastCommentAt: '2026-10-27T09:00:00.000Z',
    resolvedAt: null,
    resolvedBy: null,
    canResolve: true,
    comments: [comment()],
    ...overrides,
  };
}

export interface SentRequest {
  method: string;
  url: string;
  body: unknown;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Replaces fetch. GET lists `threads`, and changes apply to them as the server would. The next
 * `failNext` changes fail, and changes wait for `hold` while it's set.
 */
export function fakeCommentsServer(threads: CommentThreadView[]) {
  const server = {
    threads,
    canComment: true,
    failNext: 0,
    hold: undefined as Promise<void> | undefined,
    requests: [] as SentRequest[],
  };
  let count = 0;
  const findComment = (id: string) => {
    for (const each of server.threads) {
      const index = each.comments.findIndex((entry) => entry.id === id);
      if (index >= 0) return { thread: each, index };
    }
    throw new Error(`No comment ${id}.`);
  };

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    server.requests.push({ method, url, body });
    if (url === '/api/auth/me') return json(200, { user: PEOPLE.sam });
    if (method === 'GET') {
      const list: CommentsResponse = {
        threads: server.threads,
        people: PEOPLE,
        canComment: server.canComment,
      };
      return json(200, list);
    }
    await server.hold;
    if (server.failNext > 0) {
      server.failNext -= 1;
      return json(503, { error: { code: 'unavailable', message: 'Care Hub is busy. Try again.' } });
    }
    const now = new Date().toISOString();
    const change = body as { text?: string; threadId?: string; resolved?: boolean };
    const id = decodeURIComponent(url.split('/').at(-1) ?? '');
    if (method === 'POST') {
      const target = server.threads.find((each) => each.id === change.threadId);
      if (!target) throw new Error('Only replies are faked.');
      count += 1;
      const sent: CreateCommentResponse = { id: `comment-new-${count}`, threadId: target.id };
      target.comments.push(
        comment({ id: sent.id, authorId: 'sam', text: change.text ?? '', createdAt: now }),
      );
      target.resolvedAt = null;
      return json(201, sent);
    }
    if (method === 'PATCH' && url.includes('/threads/')) {
      const target = server.threads.find((each) => each.id === id);
      if (target) target.resolvedAt = change.resolved ? now : null;
    } else if (method === 'PATCH') {
      const { thread: target, index } = findComment(id);
      const edited = target.comments[index];
      if (edited) target.comments[index] = { ...edited, text: change.text ?? '', editedAt: now };
    } else if (method === 'DELETE') {
      const { thread: target, index } = findComment(id);
      target.comments.splice(index, 1);
    }
    return json(200, {});
  }) as typeof fetch;
  return server;
}
