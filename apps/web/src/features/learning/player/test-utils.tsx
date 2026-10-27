// Test-only helpers for the player (the app never imports this file).
import {
  sampleStandardCourse,
  type Course,
  type Id,
  type LearnerCourseState,
  type LessonProgress,
  type NewProgressEvent,
  type ProgressEvent,
} from '@carehub/learning';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { vi } from 'vitest';
import { withPending } from './pending';
import { Player } from './Player';

/** The fictional sample course, taken in order: Before, During and After the call, Final quiz. */
export const inOrder: Course = {
  ...sampleStandardCourse,
  settings: { ...sampleStandardCourse.settings, lessonOrder: 'sequential' },
};

/** A learner's state: every lesson not started, apart from the changes in `lessons`. */
export function learner(
  course: Course,
  lessons: Record<Id, Partial<LessonProgress>> = {},
): LearnerCourseState {
  return {
    courseId: course.id,
    status: 'in_progress',
    blockedBy: null,
    startedAt: null,
    completedAt: null,
    lastActivityAt: null,
    activeSeconds: 0,
    percentComplete: 0,
    lessons: course.lessons.map((lesson) => ({
      lessonId: lesson.id,
      status: 'not_started',
      activeSeconds: 0,
      completedBlockIds: [],
      minimumMet: true,
      lastOpenedAt: null,
      completedAt: null,
      ...lessons[lesson.id],
    })),
    quizzes: [],
    knowledgeChecks: [],
    scenarios: [],
    acknowledgedAt: null,
    score: null,
    resume: null,
    rejected: [],
  };
}

let counter = 0;
const stamp = (event: NewProgressEvent): ProgressEvent =>
  ({ ...event, id: `event-${(counter += 1)}`, at: '2026-10-27T09:00:00.000Z' }) as ProgressEvent;

export const lessonPath = (course: Course, lessonId: Id) =>
  `/learning/courses/${course.id}/lessons/${lessonId}`;

/**
 * Shows the player in a memory router at `lessonId`. Emitted events are recorded in `emit` and
 * applied to the state as the server would, so continue blocks open and lessons complete.
 */
export function renderPlayer(course: Course, state: LearnerCourseState, lessonId: Id) {
  const emit = vi.fn();
  function Harness() {
    const params = useParams();
    const [current, setCurrent] = useState(state);
    return (
      <Player
        course={course}
        state={current}
        lessonId={params.lessonId ?? ''}
        mode="learn"
        emit={(event) => {
          emit(event);
          setCurrent((before) => withPending(course, before, [stamp(event)]));
        }}
      />
    );
  }
  const view = render(
    <MemoryRouter initialEntries={[lessonPath(course, lessonId)]}>
      <Routes>
        <Route path="/learning/courses/:courseId/lessons/:lessonId" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...view, emit };
}

const reply = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const ERRORS: Record<number, { code: string; message: string }> = {
  400: { code: 'invalid', message: 'Check the link, then try again.' },
  403: { code: 'forbidden', message: "You don't have access to this." },
  404: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
};
const failure = (status: number) => reply(status, { error: ERRORS[status] });

type Call = { method: string; url: string; events: ProgressEvent[] };

/**
 * A fake Learning API on `fetch` for one course: the live course, the learner's state and the
 * events they send, applied as the server would. `server.course` is the status of the course call
 * (try 403, 404 or 400); `server.offline` makes sending events fail.
 */
export function serveCourse(
  course: Course,
  state: LearnerCourseState,
  options: { course?: number; offline?: boolean } = {},
) {
  const server = { course: 200, offline: false, ...options };
  const api = `/api/learning/courses/${course.id}`;
  let current = state;
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    calls.push({ method, url, events: body.events ?? [] });
    if (method === 'GET' && url === api) {
      if (server.course !== 200) return failure(server.course);
      return reply(200, { course, version: 3 });
    }
    if (method === 'GET' && url === `${api}/progress`) return reply(200, current);
    if (method === 'POST' && url === `${api}/events`) {
      if (server.offline) throw new TypeError('Failed to fetch');
      current = withPending(course, current, body.events);
      return reply(200, { state: current, rejected: [] });
    }
    return failure(404);
  });
  const sent = () => calls.filter((call) => call.method === 'POST').flatMap((call) => call.events);
  return { server, calls, sent };
}

/** Shows the screen for `path` from `routes` (by route) in a memory router, as in the app. */
export function renderRoute(path: string, routes: Record<string, ReactElement>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {Object.entries(routes).map(([route, element]) => (
            <Route key={route} path={route} element={element} />
          ))}
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
