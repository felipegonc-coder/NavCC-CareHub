import { courseHref, type LearnerCourseState, type ProgressEvent } from '@carehub/learning';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { progressKey } from './data';
import { PlayerScreen } from './index';
import { withPending } from './pending';
import { inOrder, learner, lessonPath } from './test-utils';

const API = `/api/learning/courses/${inOrder.id}`;
const READY = 'Ready means record open, notes read, headset on.';
const locked = { status: 'locked' } as const;
const start = learner(inOrder, {
  'calls-before': { status: 'in_progress', activeSeconds: 60 },
  'calls-during': locked,
  'calls-after': locked,
  'calls-quiz': locked,
});

type Call = { method: string; url: string; events: ProgressEvent[] };

const reply = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const ERRORS: Record<number, { code: string; message: string }> = {
  400: { code: 'invalid', message: 'Check the link, then try again.' },
  403: { code: 'forbidden', message: "You don't have access to this." },
  404: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
};
const failure = (status: number) => reply(status, { error: ERRORS[status] });

/**
 * A fake Learning API for the sample course: the live course, the learner's state and the events
 * they send, applied as the server would. `server.course` is the status of the course call (try
 * 403, 404 or 400); `server.offline` makes sending events fail.
 */
function serve(options: { course?: number; offline?: boolean } = {}) {
  const server = { course: 200, offline: false, ...options };
  let state: LearnerCourseState = start;
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    calls.push({ method, url, events: body.events ?? [] });
    if (method === 'GET' && url === API) {
      if (server.course !== 200) return failure(server.course);
      return reply(200, { course: inOrder, version: 3 });
    }
    if (method === 'GET' && url === `${API}/progress`) return reply(200, state);
    if (method === 'POST' && url === `${API}/events`) {
      if (server.offline) throw new TypeError('Failed to fetch');
      state = withPending(inOrder, state, body.events);
      return reply(200, { state, rejected: [] });
    }
    return failure(404);
  });
  const sent = () => calls.filter((call) => call.method === 'POST').flatMap((call) => call.events);
  return { server, calls, sent };
}

function renderScreen(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/learning/courses/:courseId/lessons/:lessonId" element={<PlayerScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlayerScreen', () => {
  it('says the lesson is not found for a link with a bad id, without asking the server', () => {
    const { calls } = serve();
    renderScreen('/learning/courses/no%20such%20course!/lessons/calls-before');
    expect(screen.getByRole('heading', { level: 1, name: 'Lesson not found' })).toBeInTheDocument();
    expect(document.title).toBe('Care Hub · Lesson not found');
    expect(screen.getByRole('link', { name: 'Go to My learning' })).toHaveAttribute(
      'href',
      '/learning',
    );
    expect(calls).toHaveLength(0);
  });

  it('loads the live course and the progress, then opens the lesson', async () => {
    const { calls, sent } = serve();
    renderScreen(lessonPath(inOrder, 'calls-before'));
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Before the call' }),
    ).toBeInTheDocument();
    expect(document.title).toBe('Care Hub · Before the call');
    expect(calls.filter((call) => call.method === 'GET').map((call) => call.url)).toEqual([
      API,
      `${API}/progress`,
    ]);
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]).toMatchObject({ type: 'lesson_opened', lessonId: 'calls-before' });
    expect(sent()[0]).toEqual(
      expect.objectContaining({ id: expect.any(String), at: expect.any(String) }),
    );
  });

  it('sends each step and keeps the state the server replies with', async () => {
    const { sent } = serve();
    const client = renderScreen(lessonPath(inOrder, 'calls-before'));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(READY)).toBeInTheDocument();
    await waitFor(() =>
      expect(sent()).toContainEqual(
        expect.objectContaining({
          type: 'block_completed',
          lessonId: 'calls-before',
          blockId: 'calls-before-continue',
        }),
      ),
    );
    await waitFor(() =>
      expect(
        client
          .getQueryData<LearnerCourseState>(progressKey(inOrder.id))
          ?.lessons.find((lesson) => lesson.lessonId === 'calls-before')?.completedBlockIds,
      ).toEqual(['calls-before-continue']),
    );
  });

  it('lets the learner keep going while their steps wait to be sent', async () => {
    serve({ offline: true });
    renderScreen(lessonPath(inOrder, 'calls-before'));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(READY)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says the course is not found when it is missing or not shared', async () => {
    serve({ course: 404 });
    renderScreen(lessonPath(inOrder, 'calls-before'));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Course not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to My learning' })).toBeInTheDocument();
  });

  it('tells guests that courses are not for them yet', async () => {
    serve({ course: 403 });
    renderScreen(lessonPath(inOrder, 'calls-before'));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'No access to courses' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Courses aren't available for guest accounts yet."),
    ).toBeInTheDocument();
  });

  it('says why the lesson did not load, and tries again', async () => {
    const { server } = serve({ course: 400 });
    renderScreen(lessonPath(inOrder, 'calls-before'));
    expect(
      await screen.findByRole('heading', { level: 1, name: "This lesson didn't load" }),
    ).toBeInTheDocument();
    expect(screen.getByText('Check the link, then try again.')).toBeInTheDocument();
    server.course = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Before the call' }),
    ).toBeInTheDocument();
  });

  it('says the lesson is not found when the course has no such lesson', async () => {
    serve();
    renderScreen(lessonPath(inOrder, 'calls-gone'));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Lesson not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the course' })).toHaveAttribute(
      'href',
      courseHref(inOrder.id),
    );
  });
});
