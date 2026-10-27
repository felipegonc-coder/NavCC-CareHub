// How fast a form takes responses (Forms spec, section 3): 10 a minute per person, or 30 a minute
// from everyone together for a form anyone can fill in (the package's responseRateLimit). The
// counters stay in memory for a minute and are never written down, so they don't outlast that
// minute, even for anonymous forms.

const MINUTE_MS = 60_000;

export class ResponseLimiter {
  private readonly taken = new Map<string, number[]>();
  private sweptAt = 0;

  /** Takes a place for `key` if fewer than `perMinute` were taken in the last minute. */
  take(key: string, perMinute: number, now = Date.now()): boolean {
    this.sweep(now);
    const recent = (this.taken.get(key) ?? []).filter((at) => now - at < MINUTE_MS);
    if (recent.length >= perMinute) return false;
    this.taken.set(key, [...recent, now]);
    return true;
  }

  /** Gives back the place taken at `at`, for a response that was then refused. */
  giveBack(key: string, at: number): void {
    const times = this.taken.get(key) ?? [];
    const i = times.indexOf(at);
    if (i >= 0) times.splice(i, 1);
    if (times.length === 0) this.taken.delete(key);
  }

  /** Forgets counters older than a minute, at most once a minute. */
  private sweep(now: number): void {
    if (now - this.sweptAt < MINUTE_MS) return;
    this.sweptAt = now;
    for (const [key, times] of this.taken) {
      if (times.every((at) => now - at >= MINUTE_MS)) this.taken.delete(key);
    }
  }
}
