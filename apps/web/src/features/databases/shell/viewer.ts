/**
 * Who is looking, and whether Care Hub can be reached.
 *
 * useViewer is a stand-in until useMe() is on main (decision 0007 section 4.3): then it reads the
 * person's id, time zone, week start and clock from their profile. Until then screens pass the
 * viewer in, or get the profile defaults.
 */
import { useState, useSyncExternalStore } from 'react';
import type { Viewer } from '@carehub/databases';

/** The profile defaults: Denver time, weeks start on Sunday, 12-hour clock. */
export function defaultViewer(now: Date = new Date()): Viewer {
  return { userId: '', timeZone: 'America/Denver', weekStart: 0, hour12: true, now };
}

/** The viewer given, else the profile defaults (with the time the screen opened). */
export function useViewer(given?: Viewer): Viewer {
  const [fallback] = useState(defaultViewer);
  return given ?? fallback;
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** false while the browser is offline: data stays visible and editing pauses. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}
