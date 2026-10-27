import {
  createActiveTracker,
  stepActiveTracker,
  unsentActiveSeconds,
  type ActiveTrackerInput,
  type Id,
  type NewProgressEvent,
} from '@carehub/learning';
import { useCallback, useEffect, useRef, useState } from 'react';

const ACTIVITY = ['keydown', 'pointerdown', 'pointermove', 'scroll', 'touchstart'] as const;
const TICK_MS = 5_000;

/**
 * Counts active time in the open lesson (page visible, something done in the last minute) and
 * sends it as time_active events: whole minutes as they fill up, the rest when the lesson closes or
 * the page is hidden. `unsentSeconds`, refreshed every few seconds, is counted but not sent yet;
 * `flush` sends it now, for example just before the lesson is completed. Null counts nothing.
 */
export function useActiveTime(lessonId: Id | null, emit: (event: NewProgressEvent) => void) {
  const emitRef = useRef(emit);
  const tracker = useRef(createActiveTracker());
  const [unsentSeconds, setUnsentSeconds] = useState(0);
  useEffect(() => {
    emitRef.current = emit;
  }, [emit]);

  const step = useCallback((input: ActiveTrackerInput, refresh = true) => {
    const result = stepActiveTracker(tracker.current, input);
    tracker.current = result.state;
    for (const chunk of result.chunks) emitRef.current({ type: 'time_active', ...chunk });
    if (refresh) setUnsentSeconds(unsentActiveSeconds(result.state, input.at));
  }, []);

  useEffect(() => {
    if (lessonId === null) return;
    const visible = () => document.visibilityState !== 'hidden';
    tracker.current = createActiveTracker(visible());
    step({ type: 'open', lessonId, at: Date.now() });
    const onActivity = () => step({ type: 'activity', at: Date.now() }, false);
    const onVisibility = () => step({ type: 'visibility', visible: visible(), at: Date.now() });
    for (const name of ACTIVITY) window.addEventListener(name, onActivity, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => step({ type: 'tick', at: Date.now() }), TICK_MS);
    return () => {
      window.clearInterval(timer);
      for (const name of ACTIVITY) window.removeEventListener(name, onActivity);
      document.removeEventListener('visibilitychange', onVisibility);
      step({ type: 'close', at: Date.now() });
    };
  }, [lessonId, step]);

  const flush = useCallback(() => {
    const open = tracker.current.lessonId;
    if (open === null) return;
    const at = Date.now();
    step({ type: 'close', at });
    step({ type: 'open', lessonId: open, at });
  }, [step]);

  return { unsentSeconds, flush };
}
