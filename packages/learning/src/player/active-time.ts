import type { Id } from '../format/index';

/** Time counts while the page is visible and the learner did something in the last minute. */
export const ACTIVE_TRACKER_IDLE_MS = 60_000;
/** The most seconds one time_active event carries. */
export const ACTIVE_TRACKER_MAX_SECONDS = 60;

const CHUNK_MS = ACTIVE_TRACKER_MAX_SECONDS * 1000;

/**
 * The active-time tracker's state. Times are milliseconds since 1970 (for example `Date.now()`), always passed in,
 * so the tracker is a pure state machine.
 */
export type ActiveTracker = {
  /** The open lesson, or null when no lesson is open. */
  lessonId: Id | null;
  visible: boolean;
  lastActivityAt: number | null;
  /** Time up to here has been counted. */
  countedTo: number | null;
  /** Counted but not yet sent. */
  unsentMs: number;
};

/**
 * What happened. `open` a lesson opened (or the learner moved to another one); `close` the player closed;
 * `visibility` the page was hidden or shown again; `activity` a key, pointer, touch or scroll (send it every few
 * seconds while a video or audio clip plays, too); `tick` a timer, so whole minutes are sent promptly.
 */
export type ActiveTrackerInput =
  | { type: 'open'; lessonId: Id; at: number }
  | { type: 'close'; at: number }
  | { type: 'visibility'; visible: boolean; at: number }
  | { type: 'activity'; at: number }
  | { type: 'tick'; at: number };

/** Active time for one time_active event; the caller adds the event id and time. Seconds are 1..60. */
export type ActiveTimeChunk = { lessonId: Id; seconds: number };

/** A tracker with no lesson open. Pass whether the page is visible now. */
export function createActiveTracker(visible = true): ActiveTracker {
  return { lessonId: null, visible, lastActivityAt: null, countedTo: null, unsentMs: 0 };
}

/** Active milliseconds between `countedTo` and `at`. A clock that went backwards counts nothing. */
function activeSince(state: ActiveTracker, at: number): number {
  if (
    state.lessonId === null ||
    !state.visible ||
    state.countedTo === null ||
    state.lastActivityAt === null
  )
    return 0;
  return Math.max(0, Math.min(at, state.lastActivityAt + ACTIVE_TRACKER_IDLE_MS) - state.countedTo);
}

/** Splits unsent time into chunks of at most 60 s; `everything` also sends the last whole seconds. */
function drain(
  lessonId: Id,
  ms: number,
  everything: boolean,
): { chunks: ActiveTimeChunk[]; rest: number } {
  const chunks: ActiveTimeChunk[] = [];
  let rest = ms;
  while (rest >= CHUNK_MS) {
    chunks.push({ lessonId, seconds: ACTIVE_TRACKER_MAX_SECONDS });
    rest -= CHUNK_MS;
  }
  const seconds = Math.floor(rest / 1000);
  if (everything && seconds >= 1) {
    chunks.push({ lessonId, seconds });
    rest -= seconds * 1000;
  }
  return { chunks, rest };
}

/**
 * Moves the tracker on by one input and returns the time_active chunks to send now: whole minutes as they fill
 * up, and the remaining whole seconds when the lesson changes, the player closes or the page is hidden.
 */
export function stepActiveTracker(
  state: ActiveTracker,
  input: ActiveTrackerInput,
): { state: ActiveTracker; chunks: ActiveTimeChunk[] } {
  const { at } = input;
  // Activity can't be later than now: this keeps a clock that went backwards from counting idle time.
  const lastActivityAt = state.lastActivityAt === null ? null : Math.min(state.lastActivityAt, at);
  let next: ActiveTracker = {
    ...state,
    lastActivityAt,
    unsentMs: state.unsentMs + activeSince(state, at),
    countedTo: at,
  };
  const chunks: ActiveTimeChunk[] = [];
  const send = (everything: boolean, keepRest: boolean) => {
    if (next.lessonId === null) return;
    const drained = drain(next.lessonId, next.unsentMs, everything);
    chunks.push(...drained.chunks);
    next = { ...next, unsentMs: keepRest ? drained.rest : 0 };
  };
  switch (input.type) {
    case 'open':
      if (next.lessonId !== input.lessonId) send(true, false);
      next = { ...next, lessonId: input.lessonId, lastActivityAt: at };
      break;
    case 'close':
      send(true, false);
      next = { ...next, lessonId: null };
      break;
    case 'visibility':
      if (!input.visible) send(true, true);
      next = { ...next, visible: input.visible, ...(input.visible ? { lastActivityAt: at } : {}) };
      break;
    case 'activity':
      next = { ...next, lastActivityAt: at };
      break;
    case 'tick':
      break;
  }
  send(false, true);
  return { state: next, chunks };
}

/** Whole active seconds counted but not sent yet, at `now`: add them to the saved time for a live countdown. */
export function unsentActiveSeconds(state: ActiveTracker, now: number): number {
  return Math.floor((state.unsentMs + activeSince(state, now)) / 1000);
}
