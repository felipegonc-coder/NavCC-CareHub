import {
  CourseSchema,
  LearnerCourseSchema,
  LearnerCourseStateSchema,
  ProgressEventsResponseSchema,
  learnerCourse,
  type Id,
  type LearnerCourse,
  type LearnerCourseState,
  type NewProgressEvent,
  type ProgressEvent,
} from '@carehub/learning';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { ApiError, api as coreApi } from '../../../lib/api';
import {
  api,
  apiPath,
  createEventQueue,
  flushWhenOnline,
  isRetryable,
  type EventQueue,
  type ReplySchema,
} from '../data';
import { withPending } from './pending';

// The player's calls (docs/learning/api.md): the live course, the learner's state, progress events.

/**
 * GET /courses/:id: the learner's version of a course (0311) in the learner view (0314): quiz
 * lessons have a question count, and their questions come with each attempt.
 */
export type LiveCourse = { course: LearnerCourse; version: number };

export const courseKey = (courseId: Id) => ['learning', 'course', courseId] as const;
export const progressKey = (courseId: Id) => ['learning', 'progress', courseId] as const;
export const signedInKey = ['learning', 'signed-in'] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// A full course (from a server that doesn't send the learner view yet) is turned into the learner
// view here, so the player never keeps quiz questions.
const LiveCourseReply: ReplySchema<LiveCourse> = {
  parse(data) {
    if (!isObject(data) || typeof data.version !== 'number') throw new TypeError('Not a course');
    const learner = LearnerCourseSchema.safeParse(data.course);
    const course = learner.success ? learner.data : learnerCourse(CourseSchema.parse(data.course));
    return { course, version: data.version };
  },
};

/** Tries once more after a dropped connection or a server error; never after a refusal. */
export const retryOnce = (failures: number, error: unknown) => failures < 1 && isRetryable(error);

// Route params are checked with IdSchema first, and apiPath encodes each part (0310).

export function useLiveCourse(courseId: Id) {
  return useQuery({
    queryKey: courseKey(courseId),
    queryFn: ({ signal }) => api('GET', apiPath('courses', courseId), LiveCourseReply, { signal }),
    retry: retryOnce,
  });
}

export function useLearnerState(courseId: Id) {
  return useQuery({
    queryKey: progressKey(courseId),
    queryFn: ({ signal }) =>
      api('GET', apiPath('courses', courseId, 'progress'), LearnerCourseStateSchema, { signal }),
    retry: retryOnce,
  });
}

/** What the player reads from core's GET /api/auth/me: the signed-in person's id. */
const SignedInReply = z.object({ user: z.object({ id: z.string().min(1) }) });
type SignedIn = z.infer<typeof SignedInReply>;

const signedInId = ({ user }: SignedIn) => user.id;

/** As `retryOnce`, for core's API errors. */
const retryCore = (failures: number, error: unknown) =>
  failures < 1 && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500);

/**
 * Core's GET /api/auth/me. It is read again when the window gets focus, which notices someone else
 * signing in from another tab, so it has its own entry: the profile's in data/timeZone.ts never
 * goes stale. A stand-in until core's `useMe()` is on main (0007 section 5.2); then
 * `useSignedInId` reads from it.
 */
const useSignedIn = <T>(select: (reply: SignedIn) => T) =>
  useQuery({
    queryKey: signedInKey,
    queryFn: ({ signal }) => coreApi.get('/api/auth/me', { schema: SignedInReply, signal }),
    select,
    retry: retryCore,
    refetchOnWindowFocus: true,
  });

/**
 * The signed-in person's id, from the session (never from a link), so their waiting events are
 * kept apart from anyone else's (0310).
 */
export function useSignedInId() {
  const me = useSignedIn(signedInId);
  return { userId: me.data, error: me.error, refetch: me.refetch };
}

type PersonQueue = { userId: string; queue: EventQueue<ProgressEvent> };
const queues = new WeakMap<QueryClient, PersonQueue>();

/**
 * The signed-in person's progress event queue. Their events wait in this browser's storage, under
 * their id, until the server has them, so a reload or a lost connection keeps them; starting it
 * drops anyone else's (0310). One person at a time: when someone else signs in, theirs replaces
 * it. Each reply's state goes straight into the cache.
 */
export function progressQueue(client: QueryClient, userId: string): EventQueue<ProgressEvent> {
  const current = queues.get(client);
  if (current?.userId === userId) return current.queue;
  const queue = createEventQueue<ProgressEvent>({
    userId,
    async send(courseId, events) {
      const reply = await api(
        'POST',
        apiPath('courses', courseId, 'events'),
        { events },
        ProgressEventsResponseSchema,
      );
      await client.cancelQueries({ queryKey: progressKey(courseId) });
      client.setQueryData<LearnerCourseState>(progressKey(courseId), reply.state);
    },
  });
  queues.set(client, { userId, queue });
  return queue;
}

/** A random event id. randomUUID needs a secure page; plain http (a phone on the office Wi-Fi) has
 * only getRandomValues. */
const newEventId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');

/** An event with its id and time, ready to send. */
export function stampEvent(event: NewProgressEvent, at = new Date()): ProgressEvent {
  return { ...event, id: newEventId(), at: at.toISOString() } as ProgressEvent;
}

/** While events wait (Care Hub can't be reached, say), how often they are tried again. */
export const RETRY_WAITING_MS = 20_000;

const NOTHING_WAITING: ProgressEvent[] = [];

/**
 * One course's events still waiting to be sent, `emit`, which records one, and `sendNow`. Both
 * wait for the signed-in person's id (`useLearnerCourse` holds the course back until then).
 * Waiting events go with the next step, when the browser is back online, and every 20 seconds.
 */
export function useProgressEvents(courseId: Id, userId: string | undefined) {
  const client = useQueryClient();
  const queue = userId === undefined ? null : progressQueue(client, userId);
  const [pending, setPending] = useState(() => queue?.pending(courseId) ?? NOTHING_WAITING);
  useEffect(() => {
    if (!queue) return;
    setPending(queue.pending(courseId));
    return queue.subscribe(() => setPending(queue.pending(courseId)));
  }, [queue, courseId]);
  // Events left from an earlier visit go now.
  useEffect(() => {
    if (!queue) return;
    void queue.flush();
    return flushWhenOnline(queue);
  }, [queue]);
  const waiting = queue !== null && pending.length > 0;
  useEffect(() => {
    if (!queue || !waiting) return;
    const timer = setInterval(() => void queue.flush(), RETRY_WAITING_MS);
    return () => clearInterval(timer);
  }, [queue, waiting]);
  // Times only go forward, so the server (which sorts by time) reads events in the order they came.
  const last = useRef(0);
  const stamp = useCallback((event: NewProgressEvent) => {
    last.current = Math.max(Date.now(), last.current + 1);
    return stampEvent(event, new Date(last.current));
  }, []);
  /**
   * Sends one event at once, never queued: a quiz submission needs a connection (0302, 0310).
   * Resolves with the event once the server has it and its reply's state is in the cache; rejects
   * when it can't be sent, so the quiz view can say so.
   */
  const sendNow = useCallback(
    async (event: NewProgressEvent): Promise<ProgressEvent> => {
      if (!queue) throw new Error('Not signed in yet.');
      const stamped = stamp(event);
      await queue.sendNow(courseId, [stamped]);
      return stamped;
    },
    [queue, courseId, stamp],
  );
  /** Records a step. A quiz submission goes with `sendNow` instead, so it never waits. */
  const emit = useCallback(
    (event: NewProgressEvent) => {
      if (!queue) return;
      if (event.type === 'quiz_attempt_submitted') {
        void sendNow(event).catch(() => undefined);
        return;
      }
      void queue.add(courseId, [stamp(event)]);
    },
    [queue, courseId, stamp, sendNow],
  );
  return { pending: queue ? pending : NOTHING_WAITING, emit, sendNow };
}

/**
 * A learner's course: the live version, their progress with the events not sent yet counted in,
 * those events, `emit` and `sendNow`. `course` and `state` come together, once the signed-in
 * person is known too; until then there is `error` or it is loading.
 */
export function useLearnerCourse(courseId: Id) {
  const me = useSignedInId();
  const live = useLiveCourse(courseId);
  const progress = useLearnerState(courseId);
  const { pending, emit, sendNow } = useProgressEvents(courseId, me.userId);
  const known = me.userId !== undefined;
  const course = known ? live.data?.course : undefined;
  const saved = known ? progress.data : undefined;
  const state = useMemo(
    () => (course && saved ? withPending(course, saved, pending) : undefined),
    [course, saved, pending],
  );
  const { refetch: refetchMe } = me;
  const { refetch: refetchCourse } = live;
  const { refetch: refetchProgress } = progress;
  const retry = useCallback(() => {
    void refetchMe();
    void refetchCourse();
    void refetchProgress();
  }, [refetchMe, refetchCourse, refetchProgress]);
  return {
    course: state ? course : undefined,
    state,
    pending,
    emit,
    sendNow,
    error: live.error ?? progress.error ?? me.error,
    retry,
  };
}
