import type { CommentsResponse } from '@carehub/shared';
import { ToastProvider } from '@carehub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLiveClientForTest } from '../live/client';
import { createFakeLive } from '../live/testSource';
import { commentsTopic } from './api';
import { useCommentActions, useComments } from './hooks';
import { comment, fakeCommentsServer, PAGE_ID, thread, THREAD_ID } from './testServer';

const realFetch = globalThis.fetch;
let live: ReturnType<typeof createFakeLive>;

beforeEach(() => {
  live = createFakeLive();
  setLiveClientForTest(live.client);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setLiveClientForTest(null);
});

function renderComments() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return renderHook(
    () => {
      // Read in render, as a screen does: React Query renders again only for what's read.
      const { data, isSuccess } = useComments(PAGE_ID);
      return { data, isSuccess, actions: useCommentActions(PAGE_ID) };
    },
    { wrapper },
  );
}

const texts = (data: CommentsResponse | undefined) =>
  data?.threads.flatMap((each) => each.comments.map((entry) => entry.text));

describe('useComments', () => {
  it('fetches the threads again when someone changes them', async () => {
    const server = fakeCommentsServer([thread()]);
    const { result } = renderComments();
    await waitFor(() => expect(result.current.data?.threads).toHaveLength(1));
    await act(() => live.open());
    expect(live.subscribed.has(commentsTopic(PAGE_ID))).toBe(true);

    server.threads = [...server.threads, thread({ id: 'thread-2' })];
    await act(async () => {
      live.send(
        { type: 'comments.changed', data: { pageId: PAGE_ID, threadId: 'thread-2' } },
        commentsTopic(PAGE_ID),
      );
    });
    await waitFor(() => expect(result.current.data?.threads).toHaveLength(2));
  });
});

describe('useCommentActions', () => {
  it('holds a reply while it is sent, until the threads have it', async () => {
    const server = fakeCommentsServer([thread()]);
    let release = () => {};
    server.hold = new Promise((resolve) => {
      release = resolve;
    });
    const { result } = renderComments();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    let sent: Promise<unknown> = Promise.resolve();
    await act(async () => {
      sent = result.current.actions.send({ threadId: THREAD_ID, text: 'Thursday works.' });
    });
    expect(result.current.actions.outgoing).toMatchObject([
      {
        status: 'sending',
        input: { pageId: PAGE_ID, threadId: THREAD_ID, text: 'Thursday works.' },
      },
    ]);
    await act(async () => {
      release();
      await sent;
    });
    expect(result.current.actions.outgoing).toEqual([]);
    expect(texts(result.current.data)).toEqual([
      'Can we move the home visit to Thursday?',
      'Thursday works.',
    ]);
  });

  it('keeps a reply that could not be sent, and sends it on Retry', async () => {
    const server = fakeCommentsServer([thread()]);
    server.failNext = 1;
    const { result } = renderComments();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await act(async () => {
      await result.current.actions.send({ threadId: THREAD_ID, text: 'Thursday works.' });
    });
    const [failed] = result.current.actions.outgoing;
    expect(failed).toMatchObject({ status: 'failed', error: 'Care Hub is busy. Try again.' });
    await act(async () => {
      await result.current.actions.retry(failed?.id ?? '');
    });
    expect(result.current.actions.outgoing).toEqual([]);
    expect(texts(result.current.data)).toContain('Thursday works.');
    expect(server.requests.filter((request) => request.method === 'POST')).toHaveLength(2);
  });

  it('says so when a change fails', async () => {
    const server = fakeCommentsServer([
      thread({ comments: [comment({ authorId: 'sam', canEdit: true })] }),
    ]);
    server.failNext = 1;
    const { result } = renderComments();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.actions.edit('comment-1', 'Friday instead.');
    });
    expect(saved).toBe(false);
    expect(server.requests.at(-1)).toEqual({
      method: 'PATCH',
      url: '/api/comments/comment-1',
      body: { text: 'Friday instead.' },
    });
    expect(await screen.findAllByText("Couldn't save your edit.")).not.toHaveLength(0);

    await act(async () => {
      saved = await result.current.actions.resolve(THREAD_ID, true);
    });
    expect(saved).toBe(true);
    await waitFor(() => expect(result.current.data?.threads[0]?.resolvedAt).not.toBeNull());
  });
});
