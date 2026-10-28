// How often one person may take meeting notes, counted in memory (the server is one process).

/** `allow(key)` turns false once `key` has had `limit` calls in its current minute. */
export function perMinuteLimit(limit: number, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    allow(key: string): boolean {
      const at = now();
      const window = windows.get(key);
      if (window && at - window.start < 60_000) return ++window.count <= limit;
      // Finished minutes go all at once, so the map stays small.
      if (windows.size >= 10_000) windows.clear();
      windows.set(key, { start: at, count: 1 });
      return true;
    },
  };
}
