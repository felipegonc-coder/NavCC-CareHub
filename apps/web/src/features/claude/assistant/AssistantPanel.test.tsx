import {
  ASSISTANT_TEXTS,
  CHAT_QUESTIONS_MAX,
  type AssistantChat,
  type AssistantMessage,
  type AssistantScope,
} from '@carehub/extras/claude/assistant';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALL_OFF, setClaudeStatus } from '../settings/status';
import { UNAVAILABLE } from '../write/api';
import { WRITING_TEXT } from '../write/ResultBox';
import { AssistantPanel } from './AssistantPanel';
import { closeAssistant, setPanelPerson } from './panel-state';
import { fakeApi, type Reply } from './test-api';

/** The Assistant switch as the status from the server has it (settings/status.ts). */
const setAssistantOn = (on: boolean) => setClaudeStatus({ on: { ...ALL_OFF.on, assistant: on } });

const PAGE = '3b7e9c2a-5d1f-4a6b-8c9d-0e1f2a3b4c5d';
const SOURCE = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const AT = '2026-10-27T15:00:00.000Z';
const ASK = 'POST /api/claude/assistant/ask';
const LIST = 'GET /api/claude/assistant/chats';
const chatRoute = (chatId: string) => `GET /api/claude/assistant/chats/${chatId}`;

const refunds: AssistantChat = {
  id: 'chat-refunds',
  title: 'When do refunds go out?',
  questions: 1,
  createdAt: AT,
  updatedAt: AT,
};
const REFUNDS_ANSWER = 'Refunds go out within five working days.';

const question = (id: string, text: string, scope: AssistantScope): AssistantMessage => ({
  id,
  role: 'question',
  text,
  scope,
  pages: [],
  sources: [],
  createdAt: AT,
});
const answer = (id: string, text: string): AssistantMessage => ({
  id,
  role: 'answer',
  text,
  scope: null,
  pages: [],
  sources: [{ id: SOURCE, title: 'Refund rules' }],
  createdAt: AT,
});
const shown = (chat: AssistantChat, messages: AssistantMessage[]): Reply => ({
  status: 200,
  body: { chat, messages },
});

// jsdom has no ResizeObserver; Radix tooltips and menus measure themselves.
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
  api = fakeApi({
    'GET /api/auth/me': { status: 200, body: { user: { id: 'user-avery' } } },
    [LIST]: { status: 200, body: { chats: [] } },
  });
  globalThis.fetch = api.fetch;
});

afterEach(() => {
  cleanup();
  setAssistantOn(false);
  closeAssistant();
  setPanelPerson(null);
  localStorage.clear();
  globalThis.fetch = realFetch;
});

function setUp(path = '/home') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AssistantPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Switches the Assistant on and opens the panel with the ✨ button: focus is in the question. */
async function openPanel(path?: string) {
  setAssistantOn(true);
  setUp(path);
  fireEvent.click(await screen.findByRole('button', { name: 'Open Claude' }));
  const box = screen.getByRole('textbox', { name: 'Question' });
  expect(box).toHaveFocus();
  return box;
}

function ask(box: HTMLElement, text: string) {
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
}

const panel = () => screen.queryByRole('region', { name: 'Claude' });
const conversation = () => within(screen.getByRole('region', { name: 'Conversation' }));
/** What screen readers hear from the live regions. */
const spoken = () => screen.getAllByRole('status').map((status) => status.textContent);

describe('AssistantPanel', () => {
  it('shows nothing, and asks nothing, while the Assistant is off', async () => {
    setUp();
    expect(screen.queryByRole('button', { name: 'Open Claude' })).not.toBeInTheDocument();
    expect(api.sent).toEqual([]);

    act(() => setAssistantOn(true));
    expect(await screen.findByRole('button', { name: 'Open Claude' })).toBeInTheDocument();
  });

  it('opens from the ✨ button and closes with Close or Esc, giving focus back', async () => {
    setAssistantOn(true);
    setUp();
    const launcher = await screen.findByRole('button', { name: 'Open Claude' });
    act(() => launcher.focus());
    fireEvent.click(launcher);
    const open = panel();
    expect(open).toBeInTheDocument();
    expect(within(open!).getByRole('heading', { name: 'New chat' })).toBeInTheDocument();
    expect(within(open!).getByText(ASSISTANT_TEXTS.empty)).toBeInTheDocument();
    expect(within(open!).getByRole('textbox', { name: 'Question' })).toHaveFocus();

    fireEvent.click(within(open!).getByRole('button', { name: 'Close' }));
    expect(panel()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Claude' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Open Claude' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Question' }), { key: 'Escape' });
    expect(panel()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Claude' })).toHaveFocus();
  });

  it('opens and closes with Ctrl+Alt+J', async () => {
    setAssistantOn(true);
    setUp();
    const launcher = await screen.findByRole('button', { name: 'Open Claude' });
    expect(launcher).toHaveAttribute('aria-keyshortcuts', 'Control+Alt+J');
    const shortcut = { key: 'j', code: 'KeyJ', ctrlKey: true, altKey: true };

    fireEvent.keyDown(document.body, shortcut);
    const box = screen.getByRole('textbox', { name: 'Question' });
    expect(box).toHaveFocus();
    fireEvent.keyDown(box, shortcut);
    expect(panel()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Claude' })).toHaveFocus();
  });

  it('asks about the page on show and shows the answer with its sources', async () => {
    api.routes[ASK] = 'hold';
    const box = await openPanel(`/p/${PAGE}`);
    ask(box, 'When do refunds go out?');

    expect(api.to(ASK).map(({ body }) => body)).toEqual([
      { question: 'When do refunds go out?', scope: 'this_page', pageId: PAGE, pageIds: [] },
    ]);
    expect(box).toHaveValue('');
    expect(conversation().getByText('When do refunds go out?')).toBeInTheDocument();
    expect(conversation().getByText(WRITING_TEXT)).toBeInTheDocument();
    expect(spoken()).toContain(WRITING_TEXT);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();

    const asked = question('message-1', 'When do refunds go out?', 'this_page');
    const said = answer('message-2', REFUNDS_ANSWER);
    api.routes[chatRoute(refunds.id)] = shown(refunds, [asked, said]);
    await api.held[0]!.reply({
      status: 200,
      body: { chat: refunds, question: asked, answer: said },
    });

    expect(await screen.findByRole('heading', { name: refunds.title })).toBeInTheDocument();
    expect(await conversation().findByText(REFUNDS_ANSWER)).toBeInTheDocument();
    expect(conversation().getAllByText('When do refunds go out?')).toHaveLength(1);
    expect(conversation().queryByText(WRITING_TEXT)).not.toBeInTheDocument();
    expect(spoken()).toContain(REFUNDS_ANSWER);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();

    // Full screen (as on a phone) covers the page a source opens, so it closes.
    const source = conversation().getByRole('link', { name: 'Refund rules' });
    expect(source).toHaveAttribute('href', `/p/${SOURCE}`);
    fireEvent.click(source);
    expect(panel()).not.toBeInTheDocument();
  });

  it('asks with no pages when the person says so', async () => {
    api.routes[ASK] = 'hold';
    const box = await openPanel(`/p/${PAGE}`);
    const chip = screen.getByRole('button', { name: 'What Claude may read: This page' });
    fireEvent.keyDown(chip, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'No pages' }));
    expect(
      screen.getByRole('button', { name: 'What Claude may read: No pages' }),
    ).toBeInTheDocument();

    ask(box, 'What goes in a care plan?');
    expect(api.to(ASK).map(({ body }) => body)).toEqual([
      { question: 'What goes in a care plan?', scope: 'no_pages', pageIds: [] },
    ]);
  });

  it('adds pages with @, found with Search as the person', async () => {
    api.routes['POST /api/search/query'] = {
      status: 200,
      body: {
        results: [
          { id: SOURCE, title: 'Refund rules', path: [] },
          { id: PAGE, title: 'Visit notes', path: ['Team'] },
        ],
      },
    };
    api.routes[ASK] = 'hold';
    const box = await openPanel();
    fireEvent.change(box, { target: { value: 'Compare ' } });
    fireEvent.change(box, { target: { value: 'Compare @' } });

    const find = await screen.findByRole('textbox', { name: 'Find a page' });
    fireEvent.change(find, { target: { value: 'refund' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Refund rules' }));
    expect(api.to('POST /api/search/query').at(-1)?.body).toEqual({
      text: 'refund',
      limit: 8,
      filters: { types: ['page', 'database', 'row'] },
    });
    const chips = screen.getByRole('list', { name: 'Pages Claude reads in full' });
    expect(chips).toHaveTextContent('Refund rules');
    expect(box).toHaveValue('Compare ');
    await waitFor(() => expect(box).toHaveFocus());

    ask(box, 'Compare these');
    expect(api.to(ASK).map(({ body }) => body)).toEqual([
      { question: 'Compare these', scope: 'all_pages', pageIds: [SOURCE] },
    ]);
    expect(conversation().getByText('All pages I can open · Refund rules')).toBeInTheDocument();
    expect(
      screen.queryByRole('list', { name: 'Pages Claude reads in full' }),
    ).not.toBeInTheDocument();
  });

  it('Stop gives the question back and keeps nothing', async () => {
    api.routes[ASK] = 'hold';
    const box = await openPanel(`/p/${PAGE}`);
    ask(box, 'Summarise this page');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    expect(api.held[0]!.sent.signal?.aborted).toBe(true);
    expect(box).toHaveValue('Summarise this page');
    expect(box).toHaveFocus();
    expect(conversation().queryByText(WRITING_TEXT)).not.toBeInTheDocument();
    expect(conversation().getByText(ASSISTANT_TEXTS.empty)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('Esc stops the answer on its way first, then closes the panel', async () => {
    api.routes[ASK] = 'hold';
    const box = await openPanel();
    ask(box, 'What changed this week?');

    fireEvent.keyDown(box, { key: 'Escape' });
    expect(api.held[0]!.sent.signal?.aborted).toBe(true);
    expect(panel()).toBeInTheDocument();
    expect(box).toHaveValue('What changed this week?');

    fireEvent.keyDown(box, { key: 'Escape' });
    expect(panel()).not.toBeInTheDocument();
  });

  it('switching the Assistant off closes the panel and stops the question (CL-05)', async () => {
    api.routes[ASK] = 'hold';
    const box = await openPanel(`/p/${PAGE}`);
    ask(box, 'When do refunds go out?');

    act(() => setAssistantOn(false));
    expect(api.held[0]!.sent.signal?.aborted).toBe(true);
    expect(panel()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Claude' })).not.toBeInTheDocument();

    act(() => setAssistantOn(true));
    expect(await screen.findByRole('button', { name: 'Open Claude' })).toBeInTheDocument();
    expect(panel()).not.toBeInTheDocument();
  });

  it("says when Claude isn't available, and Try again asks the same again", async () => {
    const week = { ...refunds, id: 'chat-week', title: 'What changed this week?' };
    const asked = question('message-1', 'What changed this week?', 'all_pages');
    const said = answer('message-2', 'Two visit notes were added.');
    let tries = 0;
    api.routes[ASK] = () => {
      tries += 1;
      if (tries > 1) return { status: 200, body: { chat: week, question: asked, answer: said } };
      return {
        status: 503,
        body: {
          error: {
            code: 'claude_unavailable',
            message: 'Claude could not be reached.',
            details: { reason: 'unavailable' },
          },
        },
      };
    };
    api.routes[chatRoute(week.id)] = shown(week, [asked, said]);
    const box = await openPanel();
    fireEvent.change(box, { target: { value: 'What changed this week?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await conversation().findByRole('alert')).toHaveTextContent(UNAVAILABLE);
    fireEvent.click(conversation().getByRole('button', { name: 'Try again' }));
    expect(await conversation().findByText('Two visit notes were added.')).toBeInTheDocument();
    expect(conversation().queryByRole('alert')).not.toBeInTheDocument();
    const sent = { question: 'What changed this week?', scope: 'all_pages', pageIds: [] };
    expect(api.to(ASK).map(({ body }) => body)).toEqual([sent, sent]);
  });

  it("opens one of the person's chats and asks more in it", async () => {
    const before = [
      question('message-1', 'When do refunds go out?', 'this_page'),
      answer('message-2', REFUNDS_ANSWER),
    ];
    const asked = question('message-3', 'And for cancelled visits?', 'all_pages');
    const said = answer('message-4', 'Cancelled visits are refunded the same way.');
    const after = { ...refunds, questions: 2 };
    api.routes[LIST] = { status: 200, body: { chats: [refunds] } };
    api.routes[chatRoute(refunds.id)] = shown(refunds, before);
    api.routes[ASK] = () => {
      api.routes[chatRoute(refunds.id)] = shown(after, [...before, asked, said]);
      return { status: 200, body: { chat: after, question: asked, answer: said } };
    };

    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Chats' }));
    const list = await screen.findByRole('list', { name: 'Your chats' });
    fireEvent.click(within(list).getByRole('button', { name: /^When do refunds go out\?/ }));

    expect(await screen.findByRole('heading', { name: refunds.title })).toBeInTheDocument();
    expect(await conversation().findByText(REFUNDS_ANSWER)).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: 'Question' });
    expect(box).toHaveFocus();

    ask(box, 'And for cancelled visits?');
    expect(
      await conversation().findByText('Cancelled visits are refunded the same way.'),
    ).toBeInTheDocument();
    expect(conversation().getByText(REFUNDS_ANSWER)).toBeInTheDocument();
    expect(api.to(ASK).map(({ body }) => body)).toEqual([
      {
        chatId: refunds.id,
        question: 'And for cancelled visits?',
        scope: 'all_pages',
        pageIds: [],
      },
    ]);
  });

  it('offers a new chat once a chat has as many questions as it remembers', async () => {
    const full = { ...refunds, questions: CHAT_QUESTIONS_MAX };
    api.routes[LIST] = { status: 200, body: { chats: [full] } };
    api.routes[chatRoute(full.id)] = shown(full, [
      question('message-1', 'When do refunds go out?', 'this_page'),
      answer('message-2', REFUNDS_ANSWER),
    ]);
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Chats' }));
    const list = await screen.findByRole('list', { name: 'Your chats' });
    fireEvent.click(within(list).getByRole('button', { name: /^When do refunds go out\?/ }));

    const note = await screen.findByText(ASSISTANT_TEXTS.chatFull);
    expect(screen.queryByRole('textbox', { name: 'Question' })).not.toBeInTheDocument();
    fireEvent.click(within(note.parentElement!).getByRole('button', { name: 'New chat' }));
    expect(screen.getByRole('heading', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveFocus();
  });
});
