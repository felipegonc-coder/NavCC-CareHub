import { useEffect, useRef } from 'react';
import { getLiveClient, type LiveHandler } from './client';

/** Keeps the newest handler, so a new function on every render doesn't resubscribe. */
function useLatest(handler: LiveHandler) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  return latest;
}

/**
 * Calls `handler` for each per-user event of `type` (such as `job-updated`), and with
 * `{ type: 'live-reconnected' }` after a reconnect, when events may have been missed.
 */
export function useLiveEvent(type: string, handler: LiveHandler): void {
  const latest = useLatest(handler);
  useEffect(() => getLiveClient().onEvent(type, (event) => latest.current(event)), [type, latest]);
}

/**
 * Subscribes the tab to `topic` (nothing while it's null) and calls `handler` for its events, and
 * with `{ type: 'live-reconnected' }` after a reconnect.
 */
export function useLiveTopic(topic: string | null, handler: LiveHandler): void {
  const latest = useLatest(handler);
  useEffect(() => {
    if (topic === null) return;
    return getLiveClient().onTopic(topic, (event) => latest.current(event));
  }, [topic, latest]);
}
