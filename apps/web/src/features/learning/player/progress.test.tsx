import type { NewProgressEvent, ProgressEvent } from '@carehub/learning';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { progressKey, useProgressEvents } from './data';
import { PlayerScreen } from './index';
import {
  LEARNER,
  inOrder,
  learner,
  lessonPath,
  queueKey,
  renderRoute,
  serveCourse,
} from './test-utils';

// A learner's steps on a weak connection: kept on this device, sent once it's back (0310).

const READY = 'Ready means record open, notes read, headset on.';
const NOTE = 'Your progress is saved on this device. It will be sent when the connection is back.';
const locked = { status: 'locked' } as const;
const start = learner(inOrder, {
  'calls-before': { status: 'in_progress', activeSeconds: 60 },
  'calls-during': locked,
  'calls-after': locked,
  'calls-quiz': locked,
});
const CONTINUED = expect.objectContaining({
  type: 'block_completed',
  lessonId: 'calls-before',
  blockId: 'calls-before-continue',
});
const QUIZ: NewProgressEvent = {
  type: 'quiz_attempt_submitted',
  lessonId: 'calls-quiz',
  attemptId: 'attempt-1',
  responses: {},
};

/** The events waiting in this browser for `userId`. */
const waiting = (userId = LEARNER.id): ProgressEvent[] =>
  (JSON.parse(localStorage.getItem(queueKey(userId)) ?? '[]') as { event: ProgressEvent }[]).map(
    (entry) => entry.event,
  );

const renderScreen = () =>
  renderRoute(lessonPath(inOrder, 'calls-before'), {
    '/learning/courses/:courseId/lessons/:lessonId': <PlayerScreen />,
  });

/** What the browser says about its connection, with the event it fires when that changes. */
function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

const withClient = (client: QueryClient) => ({
  wrapper: ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  ),
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  Reflect.deleteProperty(navigator, 'onLine');
});

describe('progress on a weak connection', () => {
  it('keeps the steps on this device while offline, and sends them on the next visit', async () => {
    const { server, sent } = serveCourse(inOrder, start, { offline: true });
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(READY)).toBeInTheDocument();
    await waitFor(() => expect(waiting()).toContainEqual(CONTINUED));
    expect(sent()).toHaveLength(0);
    cleanup();
    server.offline = false;
    renderScreen();
    expect(await screen.findByText(READY)).toBeInTheDocument();
    await waitFor(() => expect(sent()).toContainEqual(CONTINUED));
    await waitFor(() => expect(waiting()).toHaveLength(0));
  });

  it("drops anyone else's waiting steps from this browser, and never sends them", async () => {
    const theirs = {
      type: 'lesson_opened',
      lessonId: 'calls-before',
      id: 'their-step',
      at: '2026-10-26T09:00:00.000Z',
    };
    localStorage.setItem(
      queueKey('learner-2'),
      JSON.stringify([{ courseId: inOrder.id, event: theirs }]),
    );
    localStorage.setItem('carehub:theme', 'dark');
    const { sent } = serveCourse(inOrder, start);
    renderScreen();
    await waitFor(() =>
      expect(sent()).toContainEqual(expect.objectContaining({ type: 'lesson_opened' })),
    );
    expect(localStorage.getItem(queueKey('learner-2'))).toBeNull();
    expect(localStorage.getItem('carehub:theme')).toBe('dark');
    expect(sent().map((event) => event.id)).not.toContain('their-step');
  });

  it('says the progress is saved on this device while offline, until it is sent', async () => {
    const { server, sent } = serveCourse(inOrder, start, { offline: true });
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    setOnline(false);
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
    expect(screen.getByText(NOTE).closest('[role="status"]')).not.toBeNull();
    expect(screen.getByText(READY)).toBeInTheDocument();
    server.offline = false;
    setOnline(true);
    await waitFor(() => expect(sent()).toContainEqual(CONTINUED));
    await waitFor(() => expect(waiting()).toHaveLength(0));
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });
});

describe('useProgressEvents', () => {
  it('sends a quiz submission at once, and never keeps it to send later', async () => {
    const { server, calls, sent } = serveCourse(inOrder, start, { offline: true });
    const client = new QueryClient();
    const { result } = renderHook(
      () => useProgressEvents(inOrder.id, LEARNER.id),
      withClient(client),
    );
    await expect(result.current.sendNow(QUIZ)).rejects.toMatchObject({ status: 0 });
    act(() => result.current.emit(QUIZ));
    await waitFor(() => expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2));
    expect(waiting()).toEqual([]);
    expect(result.current.pending).toEqual([]);
    expect(client.getQueryData(progressKey(inOrder.id))).toBeUndefined();
    server.offline = false;
    const event = await result.current.sendNow(QUIZ);
    expect(event).toMatchObject({ ...QUIZ, id: expect.any(String), at: expect.any(String) });
    expect(sent()).toEqual([event]);
    expect(client.getQueryData(progressKey(inOrder.id))).toEqual(start);
  });

  it('records nothing before the signed-in person is known', async () => {
    const { calls } = serveCourse(inOrder, start);
    const { result } = renderHook(
      () => useProgressEvents(inOrder.id, undefined),
      withClient(new QueryClient()),
    );
    act(() => result.current.emit({ type: 'lesson_opened', lessonId: 'calls-before' }));
    await expect(result.current.sendNow(QUIZ)).rejects.toThrow('Not signed in yet.');
    expect(result.current.pending).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(localStorage.length).toBe(0);
  });
});
