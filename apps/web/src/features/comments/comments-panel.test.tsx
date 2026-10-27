import { ToastProvider } from '@carehub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setLiveClientForTest } from '../live/client';
import { createFakeLive } from '../live/testSource';
import { commentsTopic } from './api';
import { CommentsPanel, type CommentsPanelProps } from './comments-panel';
import { comment, fakeCommentsServer, PAGE_ID, thread, THREAD_ID } from './testServer';

// jsdom has no ResizeObserver, which some Radix parts measure with.
class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}

const realFetch = globalThis.fetch;
let live: ReturnType<typeof createFakeLive>;

beforeAll(() => {
  window.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  live = createFakeLive();
  setLiveClientForTest(live.client);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setLiveClientForTest(null);
});

function renderPanel(props: Partial<CommentsPanelProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <CommentsPanel pageId={PAGE_ID} {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function nth<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`There is no item ${index}.`);
  return item;
}

const reply = (card: HTMLElement, text: string) => {
  const box = within(card).getByRole('textbox', { name: 'Reply' });
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
  return box;
};

const yours = comment({
  id: 'comment-2',
  authorId: 'sam',
  text: 'Thursday works.',
  canEdit: true,
  canDelete: true,
});

describe('CommentsPanel', () => {
  it('shows each thread with what it is on, its comments and its people', async () => {
    fakeCommentsServer([
      thread({
        spot: 'text',
        blockId: 'b1',
        quote: 'Home visit on Tuesday at 10',
        comments: [
          comment({ text: 'Can we move this, <@sam>?', editedAt: '2026-10-27T09:05:00.000Z' }),
          comment({ id: 'comment-2', authorId: 'left-in-2025', text: 'Tuesday is full.' }),
        ],
      }),
      thread({
        id: 'thread-2',
        comments: [comment({ id: 'comment-3', text: '', deleted: true }), yours],
      }),
    ]);
    let closes = 0;
    renderPanel({
      locate: (each) => (each.id === THREAD_ID ? null : undefined),
      onClose: () => (closes += 1),
    });

    const onText = await screen.findByRole('article', { name: 'On text, 2 comments' });
    expect(within(onText).getByText('The text this was on was deleted.')).toBeInTheDocument();
    expect(within(onText).getByText('Home visit on Tuesday at 10')).toBeInTheDocument();
    expect(within(onText).getByText('@Sam Ortiz')).toBeInTheDocument();
    expect(within(onText).getByText('(edited)')).toBeInTheDocument();
    expect(within(onText).getByText('(removed)')).toBeInTheDocument();
    const onPage = screen.getByRole('article', { name: 'On the page, 2 comments' });
    expect(within(onPage).getByText('This comment was deleted')).toBeInTheDocument();
    // The page's own threads come first.
    expect(screen.getAllByRole('article')).toEqual([onPage, onText]);

    fireEvent.click(screen.getByRole('button', { name: 'Close comments' }));
    expect(closes).toBe(1);
  });

  it('shows a reply faded while it is sent', async () => {
    const server = fakeCommentsServer([thread()]);
    let release = () => {};
    server.hold = new Promise((resolve) => {
      release = resolve;
    });
    renderPanel();
    const card = await screen.findByRole('article', { name: 'On the page, 1 comment' });

    expect(reply(card, 'Thursday works.')).toHaveValue('');
    const sending = await within(card).findByText('Thursday works.');
    expect(sending.closest('li')).toHaveAttribute('aria-busy', 'true');
    await act(async () => release());
    await waitFor(() => expect(card).toHaveAccessibleName('On the page, 2 comments'));
    expect(within(card).getByText('Thursday works.').closest('li')).not.toHaveAttribute(
      'aria-busy',
    );
    expect(server.requests).toContainEqual({
      method: 'POST',
      url: '/api/comments',
      body: { pageId: PAGE_ID, threadId: THREAD_ID, text: 'Thursday works.' },
    });
  });

  it('keeps a reply that was not sent, for Retry or Delete', async () => {
    const server = fakeCommentsServer([thread()]);
    server.failNext = 2;
    renderPanel();
    const card = await screen.findByRole('article', { name: 'On the page, 1 comment' });
    reply(card, 'Thursday works.');
    reply(card, 'Or Friday.');
    await waitFor(() => expect(within(card).getAllByRole('alert')).toHaveLength(2));
    expect(nth(within(card).getAllByRole('alert'), 0)).toHaveTextContent(
      'Not sent · Retry · Delete',
    );

    fireEvent.click(nth(within(card).getAllByRole('button', { name: 'Delete' }), 1));
    expect(within(card).queryByText('Or Friday.')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(card).toHaveAccessibleName('On the page, 2 comments'));
    expect(within(card).queryByRole('alert')).toBeNull();
  });

  it('edits your own comment, also with ↑ in the reply box', async () => {
    const server = fakeCommentsServer([thread({ comments: [comment(), yours] })]);
    renderPanel();
    const card = await screen.findByRole('article', { name: 'On the page, 2 comments' });
    expect(within(card).getAllByRole('button', { name: 'Edit comment' })).toHaveLength(1);

    fireEvent.keyDown(within(card).getByRole('textbox', { name: 'Reply' }), { key: 'ArrowUp' });
    const editor = within(card).getByRole('textbox', { name: 'Edit comment' });
    expect(editor).toHaveValue('Thursday works.');
    expect(editor).toHaveFocus();
    fireEvent.change(editor, { target: { value: 'Friday works better.' } });
    fireEvent.keyDown(editor, { key: 'Enter' });

    // The box closes once the thread has the edit.
    await waitFor(() =>
      expect(within(card).queryByRole('textbox', { name: 'Edit comment' })).toBeNull(),
    );
    expect(within(card).getByText('Friday works better.')).toBeInTheDocument();
    expect(within(card).getByText('(edited)')).toBeInTheDocument();
    expect(server.requests).toContainEqual({
      method: 'PATCH',
      url: '/api/comments/comment-2',
      body: { text: 'Friday works better.' },
    });

    fireEvent.click(within(card).getByRole('button', { name: 'Edit comment' }));
    fireEvent.keyDown(within(card).getByRole('textbox', { name: 'Edit comment' }), {
      key: 'Escape',
    });
    expect(within(card).queryByRole('textbox', { name: 'Edit comment' })).toBeNull();
  });

  it('deletes a comment after asking', async () => {
    const server = fakeCommentsServer([thread({ comments: [comment(), yours] })]);
    renderPanel();
    const card = await screen.findByRole('article', { name: 'On the page, 2 comments' });
    fireEvent.click(within(card).getByRole('button', { name: 'Delete comment' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this comment?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(card).toHaveAccessibleName('On the page, 1 comment'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(server.requests).toContainEqual({
      method: 'DELETE',
      url: '/api/comments/comment-2',
      body: undefined,
    });
  });

  it('resolves a thread, and reopens it from Resolved', async () => {
    fakeCommentsServer([thread()]);
    renderPanel();
    const card = await screen.findByRole('article', { name: 'On the page, 1 comment' });
    fireEvent.click(within(card).getByRole('button', { name: 'Resolve' }));
    expect(await screen.findByText('No comments yet.')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Resolved' }));
    const resolved = await screen.findByRole('article', { name: 'On the page, 1 comment' });
    fireEvent.click(within(resolved).getByRole('button', { name: 'Reopen' }));
    expect(await screen.findByText('No resolved comments.')).toBeInTheDocument();
  });

  it('shows For me, and threads others start, within moments', async () => {
    const server = fakeCommentsServer([
      thread({ id: 'thread-a', comments: [comment({ text: 'Who can drive on Thursday?' })] }),
      thread({
        id: 'thread-b',
        comments: [comment({ id: 'comment-2', text: 'Can you, <@sam>?' })],
      }),
    ]);
    renderPanel();
    await screen.findByText('Who can drive on Thursday?');
    await act(() => live.open());

    const forMe = screen.getByRole('button', { name: 'For me' });
    expect(forMe).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(forMe);
    expect(forMe).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('@Sam Ortiz')).toBeInTheDocument();
    expect(screen.queryByText('Who can drive on Thursday?')).toBeNull();

    server.threads = [
      ...server.threads,
      thread({
        id: 'thread-c',
        comments: [comment({ id: 'comment-3', authorId: 'sam', text: 'I can drive.' })],
      }),
    ];
    await act(async () => {
      live.send(
        { type: 'comments.changed', data: { pageId: PAGE_ID, threadId: 'thread-c' } },
        commentsTopic(PAGE_ID),
      );
    });
    expect(await screen.findByText('I can drive.')).toBeInTheDocument();
  });

  it('moves between threads with ↑ and ↓, and opens one', async () => {
    fakeCommentsServer([
      thread({ id: 'thread-a' }),
      thread({ id: 'thread-b', spot: 'block', blockId: 'b1' }),
    ]);
    const opened: string[] = [];
    renderPanel({ onOpenThread: (each) => void opened.push(each.id) });
    const first = await screen.findByRole('button', { name: 'On the page' });
    const second = screen.getByRole('button', { name: 'On a block' });

    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'ArrowUp' });
    expect(first).toHaveFocus();

    fireEvent.click(second);
    expect(opened).toEqual(['thread-b']);
    const card = screen.getByRole('article', { name: 'On a block, 1 comment' });
    expect(within(card).getByRole('textbox', { name: 'Reply' })).toHaveFocus();
  });

  it('has no reply box or Resolve without the access for them', async () => {
    const server = fakeCommentsServer([thread({ canResolve: false })]);
    server.canComment = false;
    renderPanel();
    const card = await screen.findByRole('article', { name: 'On the page, 1 comment' });
    expect(within(card).queryByRole('textbox')).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Resolve' })).toBeNull();
  });

  it('offers Try again when the threads could not load', async () => {
    globalThis.fetch = (async () =>
      new Response('{}', {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    renderPanel();
    expect(await screen.findByText("Couldn't load comments.")).toBeInTheDocument();
    fakeCommentsServer([]);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No comments yet.')).toBeInTheDocument();
  });
});
