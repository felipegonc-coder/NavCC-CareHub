import {
  CourseSchema,
  type Course,
  type Id,
  type LearnerCourseState,
  type NewProgressEvent,
  type ProgressEvent,
} from '@carehub/learning';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  createEventQueue,
  flushWhenOnline,
  isRetryable,
  type EventQueue,
  type ReplySchema,
} from '../data';

// The player's calls (docs/learning/api.md): the live course, the learner's state, progress events.

/** GET /courses/:id: the live version of a course, as learners see it. */
export type LiveCourse = { course: Course; version: number };

export const courseKey = (courseId: Id) => ['learning', 'course', courseId] as const;
export const progressKey = (courseId: Id) => ['learning', 'progress', courseId] as const;

// Route params are checked with IdSchema first, so each id is one safe path segment (0310).
const coursePath = (courseId: Id) => `/courses/${encodeURIComponent(courseId)}`;

// Stand-ins until B1's LiveCourseSchema and B3's LearnerCourseStateSchema reach main.
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const LiveCourseReply: ReplySchema<LiveCourse> = {
  parse(data) {
    if (!isObject(data) || typeof data.version !== 'number') throw new TypeError('Not a course');
    return { course: CourseSchema.parse(data.course), version: data.version };
  },
};

const STATE_LISTS = ['lessons', 'quizzes', 'knowledgeChecks', 'scenarios', 'rejected'];

const StateReply: ReplySchema<LearnerCourseState> = {
  parse(data) {
    if (
      !isObject(data) ||
      typeof data.courseId !== 'string' ||
      typeof data.status !== 'string' ||
      !STATE_LISTS.every((key) => Array.isArray(data[key]))
    )
      throw new TypeError('Not a learner state');
    return data as LearnerCourseState;
  },
};

const EventsReply: ReplySchema<{ state: LearnerCourseState }> = {
  parse(data) {
    if (!isObject(data) || !Array.isArray(data.rejected))
      throw new TypeError('Not an events reply');
    return { state: StateReply.parse(data.state) };
  },
};

/** Tries once more after a dropped connection or a server error; never after a refusal. */
const retry = (failures: number, error: unknown) => failures < 1 && isRetryable(error);

export function useLiveCourse(courseId: Id) {
  return useQuery({
    queryKey: courseKey(courseId),
    queryFn: ({ signal }) => api('GET', coursePath(courseId), LiveCourseReply, { signal }),
    retry,
  });
}

export function useLearnerState(courseId: Id) {
  return useQuery({
    queryKey: progressKey(courseId),
    queryFn: ({ signal }) => api('GET', `${coursePath(courseId)}/progress`, StateReply, { signal }),
    retry,
  });
}

const queues = new WeakMap<QueryClient, EventQueue<ProgressEvent>>();

/**
 * The progress event queue. Each reply's state goes straight into the cache. It stays in memory
 * until the web app knows who is signed in; then it keeps each person's events apart (0310).
 */
export function progressQueue(client: QueryClient): EventQueue<ProgressEvent> {
  let queue = queues.get(client);
  if (!queue) {
    queue = createEventQueue<ProgressEvent>({
      userId: 'signed-in',
      storage: null,
      async send(courseId, events) {
        const reply = await api('POST', `${coursePath(courseId)}/events`, { events }, EventsReply);
        await client.cancelQueries({ queryKey: progressKey(courseId) });
        client.setQueryData<LearnerCourseState>(progressKey(courseId), reply.state);
      },
    });
    queues.set(client, queue);
  }
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

/** One course's events still waiting to be sent, and `emit`, which records one. */
export function useProgressEvents(courseId: Id) {
  const queue = progressQueue(useQueryClient());
  const [pending, setPending] = useState(() => queue.pending(courseId));
  useEffect(() => {
    setPending(queue.pending(courseId));
    return queue.subscribe(() => setPending(queue.pending(courseId)));
  }, [queue, courseId]);
  useEffect(() => flushWhenOnline(queue), [queue]);
  // Times only go forward, so the server (which sorts by time) reads events in the order they came.
  const last = useRef(0);
  const emit = useCallback(
    (event: NewProgressEvent) => {
      last.current = Math.max(Date.now(), last.current + 1);
      void queue.add(courseId, [stampEvent(event, new Date(last.current))]);
    },
    [queue, courseId],
  );
  return { pending, emit };
}
