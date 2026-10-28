// Test-only helpers for the player (the app never imports this file).
import {
  learnerCourse,
  sampleStandardCourse,
  type Course,
  type Id,
  type LearnerCourseState,
  type LessonProgress,
  type NewProgressEvent,
  type PlayerCourse,
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
  course: PlayerCourse,
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

export const lessonPath = (course: Pick<PlayerCourse, 'id'>, lessonId: Id) =>
  `/learning/courses/${course.id}/lessons/${lessonId}`;

/**
 * Shows the player in a memory router at `lessonId`. Emitted events are recorded in `emit` and
 * applied to the state as the server would, so continue blocks open and lessons complete.
 */
export function renderPlayer(course: PlayerCourse, state: LearnerCourseState, lessonId: Id) {
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

/** A JSON reply from the fake Learning API. */
export const jsonReply = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const ERRORS: Record<number, { code: string; message: string }> = {
  400: { code: 'invalid', message: 'Check the link, then try again.' },
  403: { code: 'forbidden', message: "You don't have access to this." },
  404: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
};
/** The Learning API's error reply for 400, 403 or 404. */
export const errorReply = (status: number) => jsonReply(status, { error: ERRORS[status] });

type Call = { method: string; url: string };

/**
 * The fictional learner the fake API signs in. Their profile is on Tokyo time: neither the test
 * browser's zone nor the default, so times on the page show which zone they're in.
 */
export const LEARNER = {
  id: 'learner-1',
  email: 'lee.learner@example.test',
  name: 'Lee Learner',
  timeZone: 'Asia/Tokyo',
};

/** Core's GET /api/auth/me reply for the learner, with `user` changed as given. */
export const signedInReply = (user: { id?: string; timeZone?: string | null } = {}) =>
  jsonReply(200, { user: { ...LEARNER, ...user }, member: null, workspace: null });

/** Where the learner's waiting events are kept in this browser (the shared event queue). */
export const queueKey = (userId = LEARNER.id) => `carehub.learning.events.v1:${userId}`;

type ServeOptions = {
  course?: number;
  offline?: boolean;
  full?: boolean;
  /** Who core's GET /api/auth/me says is signed in, or its error status (try 401). */
  me?: string | number;
};

/**
 * A fake Learning API on `fetch` for one course: its learner view, the learner's state and the
 * events they send, applied as the server would, plus core's GET /api/auth/me. `server.course` is
 * the status of the course call (try 403, 404 or 400); `server.offline` makes sending events fail;
 * `full` sends the whole course, as a server that doesn't send the learner view yet. `sent()` is
 * the events the server has.
 */
export function serveCourse(course: Course, state: LearnerCourseState, options: ServeOptions = {}) {
  const server = { course: 200, offline: false, full: false, me: LEARNER.id, ...options };
  const api = `/api/learning/courses/${course.id}`;
  let current = state;
  const calls: Call[] = [];
  const received: ProgressEvent[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    calls.push({ method, url });
    if (method === 'GET' && url === '/api/auth/me') {
      if (typeof server.me === 'number') return jsonReply(server.me, {});
      return signedInReply({ id: server.me });
    }
    if (method === 'GET' && url === api) {
      if (server.course !== 200) return errorReply(server.course);
      return jsonReply(200, { course: server.full ? course : learnerCourse(course), version: 3 });
    }
    if (method === 'GET' && url === `${api}/progress`) return jsonReply(200, current);
    if (method === 'POST' && url === `${api}/events`) {
      if (server.offline) throw new TypeError('Failed to fetch');
      received.push(...body.events);
      current = withPending(course, current, body.events);
      return jsonReply(200, { state: current, rejected: [] });
    }
    return errorReply(404);
  });
  const sent = () => [...received];
  return { server, calls, sent };
}

/**
 * Shows the screen for `path` (with router state, if given) from `routes` (by route) in a memory
 * router, as in the app.
 */
export function renderRoute(
  path: string | { pathname: string; state: unknown },
  routes: Record<string, ReactElement>,
) {
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
