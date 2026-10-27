import { LearningApiError } from './http';

// The offline event queue: progress events wait in the browser until the server has them, so a learner can keep
// going on a weak connection. Events have ids and the server ignores ids it already has, so sending twice is safe.

/** Anything with a unique id, such as a progress event. Stored as JSON. */
export type QueuedEvent = { id: string };

export type QueueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Events that will never be sent: the server refused them for good, or the queue was full. */
export type DroppedEvents<E> = {
  courseId: string;
  events: E[];
  reason: 'refused' | 'full';
  error?: unknown;
};

export type EventQueueOptions<E extends QueuedEvent> = {
  /** One queue per signed-in person, so nobody's events are ever sent as someone else's. */
  userId: string;
  /** Sends some of one course's events; resolves once the server has them. Usually an `api` call. */
  send(courseId: string, events: E[]): Promise<void>;
  onDrop?(dropped: DroppedEvents<E>): void;
  /** Where events wait: `localStorage` by default, or memory only with `null`. */
  storage?: QueueStorage | null;
  /** Events per request (default 50). */
  batchSize?: number;
  /** The oldest events are dropped beyond this many (default 2,000). */
  maxEvents?: number;
};

export type EventQueue<E extends QueuedEvent> = {
  /** Adds events (ids already waiting are skipped), then tries to send everything. */
  add(courseId: string, events: readonly E[]): Promise<void>;
  /** Sends everything waiting, oldest first. Never rejects; whatever can't be sent yet keeps waiting. */
  flush(): Promise<void>;
  /** The events still waiting, for one course or all. */
  pending(courseId?: string): E[];
  /** Calls `listener` whenever the waiting events change; returns a function that stops it. */
  subscribe(listener: () => void): () => void;
  /** Forgets every waiting event. */
  clear(): void;
};

type Entry<E> = { courseId: string; event: E };

const KEY_PREFIX = 'carehub.learning.events.v1:';

/** Whether a failed send is worth trying again later: offline, signed out, too many tries or a server problem. */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof LearningApiError)) return true;
  const { status } = error;
  return status === 0 || status === 401 || status === 408 || status === 429 || status >= 500;
}

export function createEventQueue<E extends QueuedEvent>(
  options: EventQueueOptions<E>,
): EventQueue<E> {
  const key = KEY_PREFIX + options.userId;
  const batchSize = Math.max(1, options.batchSize ?? 50);
  const maxEvents = Math.max(1, options.maxEvents ?? 2000);
  let storage = options.storage === undefined ? browserStorage() : options.storage;
  let memory: Entry<E>[] = [];
  const listeners = new Set<() => void>();
  let running: Promise<void> | null = null;
  let again = false;

  function read(): Entry<E>[] {
    if (!storage) return [...memory];
    try {
      const parsed: unknown = JSON.parse(storage.getItem(key) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter(isEntry<E>) : [];
    } catch {
      return [...memory];
    }
  }

  function write(entries: Entry<E>[]) {
    memory = entries;
    try {
      storage?.setItem(key, JSON.stringify(entries));
    } catch {
      storage = null; // full or blocked: keep going in memory
    }
    for (const listener of listeners) listener();
  }

  function drop(dropped: DroppedEvents<E>) {
    try {
      options.onDrop?.(dropped);
    } catch {
      // a broken listener must not stop the queue
    }
  }

  function remove(courseId: string, events: E[]) {
    const ids = new Set(events.map((event) => event.id));
    write(read().filter((entry) => entry.courseId !== courseId || !ids.has(entry.event.id)));
  }

  async function sendAll() {
    const sent = new Set<string>();
    for (;;) {
      const entries = read();
      const courseId = entries[0]?.courseId;
      if (courseId === undefined) return;
      const batch = entries
        .filter((entry) => entry.courseId === courseId)
        .slice(0, batchSize)
        .map((entry) => entry.event);
      const ids = batch.map((event) => `${courseId}\n${event.id}`);
      if (ids.every((id) => sent.has(id))) return; // storage didn't take the removal; stop rather than loop
      for (const id of ids) sent.add(id);
      try {
        await options.send(courseId, batch);
      } catch (error) {
        if (isRetryable(error)) return;
        remove(courseId, batch);
        drop({ courseId, events: batch, reason: 'refused', error });
        continue;
      }
      remove(courseId, batch);
    }
  }

  function flush(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await sendAll();
        } while (again);
      } catch {
        // whatever wasn't sent keeps waiting
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    async add(courseId, events) {
      const entries = read();
      const waiting = new Set(
        entries.filter((entry) => entry.courseId === courseId).map((entry) => entry.event.id),
      );
      for (const event of events) {
        if (waiting.has(event.id)) continue;
        waiting.add(event.id);
        entries.push({ courseId, event });
      }
      const overflow = entries.splice(0, Math.max(0, entries.length - maxEvents));
      write(entries);
      for (const [course, dropped] of byCourse(overflow))
        drop({ courseId: course, events: dropped, reason: 'full' });
      await flush();
    },
    flush,
    pending(courseId) {
      return read()
        .filter((entry) => courseId === undefined || entry.courseId === courseId)
        .map((entry) => entry.event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      write([]);
    },
  };
}

/** Sends the queue whenever the browser comes back online; returns a function that stops it. */
export function flushWhenOnline(queue: Pick<EventQueue<QueuedEvent>, 'flush'>): () => void {
  if (typeof window === 'undefined') return () => {};
  const onOnline = () => void queue.flush();
  window.addEventListener('online', onOnline);
  return () => window.removeEventListener('online', onOnline);
}

function isEntry<E>(value: unknown): value is Entry<E> {
  if (typeof value !== 'object' || value === null) return false;
  const { courseId, event } = value as { courseId?: unknown; event?: unknown };
  return (
    typeof courseId === 'string' &&
    typeof event === 'object' &&
    event !== null &&
    typeof (event as { id?: unknown }).id === 'string'
  );
}

function byCourse<E>(entries: Entry<E>[]): Map<string, E[]> {
  const groups = new Map<string, E[]>();
  for (const { courseId, event } of entries)
    groups.set(courseId, [...(groups.get(courseId) ?? []), event]);
  return groups;
}

function browserStorage(): QueueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
