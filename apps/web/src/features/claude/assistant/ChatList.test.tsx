import type { AssistantChat } from '@carehub/extras/claude/assistant';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatList, NO_CHATS, type ChatListProps } from './ChatList';
import { fakeApi } from './test-api';

const LIST = 'GET /api/claude/assistant/chats';
const path = (chatId: string) => `/api/claude/assistant/chats/${chatId}`;

const chat = (id: string, title: string, updatedAt: string): AssistantChat => ({
  id,
  title,
  questions: 2,
  createdAt: updatedAt,
  updatedAt,
});

const visits = chat('chat-visits', 'Visit notes for March', '2026-10-27T15:00:00.000Z');
const refunds = chat('chat-refunds', 'Refund rules', '2026-10-26T09:00:00.000Z');

// jsdom has no ResizeObserver; Radix menus measure themselves.
class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}

const realFetch = globalThis.fetch;
let api: ReturnType<typeof fakeApi>;

beforeAll(() => {
  window.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  api = fakeApi({ [LIST]: { status: 200, body: { chats: [visits, refunds] } } });
  globalThis.fetch = api.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function setUp(props: Partial<ChatListProps> = {}) {
  const handlers = { onOpen: vi.fn(), onDeleted: vi.fn(), onNoRows: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ChatList person="user-avery" current={refunds.id} {...handlers} {...props} />
    </QueryClientProvider>,
  );
  return handlers;
}

/** Opens a chat's "…" menu and picks Rename or Delete. */
async function choose(title: string, item: 'Rename' | 'Delete') {
  const more = await screen.findByRole('button', { name: `More for ${title}` });
  fireEvent.keyDown(more, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
}

describe('ChatList', () => {
  it('lists the chats, last used first, and opens one', async () => {
    const { onOpen } = setUp();
    const list = await screen.findByRole('list', { name: 'Your chats' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Visit notes for March');
    expect(rows[1]).toHaveTextContent('Refund rules');
    const open = within(list).getByRole('button', { name: /^Refund rules/ });
    const other = within(list).getByRole('button', { name: /^Visit notes for March/ });
    expect(open).toHaveAttribute('aria-current', 'true');
    expect(other).not.toHaveAttribute('aria-current');

    fireEvent.click(other);
    expect(onOpen).toHaveBeenCalledWith(visits.id);
  });

  it('says when there are no chats yet', async () => {
    api.routes[LIST] = { status: 200, body: { chats: [] } };
    setUp();
    expect(await screen.findByText(NO_CHATS)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('says when the chats could not load, and Retry loads them', async () => {
    api.routes[LIST] = { status: 500, body: { error: { code: 'internal', message: 'Broke.' } } };
    setUp();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your chats.");

    api.routes[LIST] = { status: 200, body: { chats: [refunds] } };
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const list = await screen.findByRole('list', { name: 'Your chats' });
    expect(list).toHaveTextContent('Refund rules');
  });

  it('renames a chat, and asks for a name when there is none', async () => {
    api.routes[`PATCH ${path(refunds.id)}`] = ({ body }) => ({
      status: 200,
      body: { chat: { ...refunds, title: (body as { title: string }).title } },
    });
    setUp();
    await choose('Refund rules', 'Rename');
    const dialog = await screen.findByRole('dialog', { name: 'Rename chat' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveValue('Refund rules');

    fireEvent.change(name, { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Type a name.')).toBeInTheDocument();
    expect(api.to(`PATCH ${path(refunds.id)}`)).toHaveLength(0);

    fireEvent.change(name, { target: { value: '  Refunds and credits ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.to(`PATCH ${path(refunds.id)}`).map(({ body }) => body)).toEqual([
      { title: 'Refunds and credits' },
    ]);
    expect(screen.getByRole('button', { name: /^Refunds and credits/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'More for Refunds and credits' })).toHaveFocus(),
    );
  });

  it('deletes chats for good, moving focus to the next one', async () => {
    api.routes[`DELETE ${path(visits.id)}`] = { status: 204 };
    api.routes[`DELETE ${path(refunds.id)}`] = { status: 204 };
    const { onDeleted, onNoRows } = setUp();

    await choose('Visit notes for March', 'Delete');
    let dialog = await screen.findByRole('dialog', { name: 'Delete this chat?' });
    expect(dialog).toHaveTextContent(
      '“Visit notes for March” and its answers are deleted for good.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onDeleted).toHaveBeenCalledWith(visits.id);
    expect(screen.queryByText('Visit notes for March')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Refund rules/ })).toHaveFocus(),
    );

    await choose('Refund rules', 'Delete');
    dialog = await screen.findByRole('dialog', { name: 'Delete this chat?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(NO_CHATS)).toBeInTheDocument();
    await waitFor(() => expect(onNoRows).toHaveBeenCalled());
    expect(onDeleted).toHaveBeenLastCalledWith(refunds.id);
  });

  it('keeps the dialog open with the reason when a chat could not be deleted', async () => {
    api.routes[`DELETE ${path(refunds.id)}`] = { status: 500, body: {} };
    const { onDeleted } = setUp();
    await choose('Refund rules', 'Delete');
    const dialog = await screen.findByRole('dialog', { name: 'Delete this chat?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Something went wrong. Try again.',
    );
    expect(onDeleted).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'More for Refund rules' })).toHaveFocus(),
    );
    expect(screen.getByRole('list', { name: 'Your chats' })).toHaveTextContent('Refund rules');
  });
});
