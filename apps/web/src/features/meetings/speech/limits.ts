/** MT-14: a recording stops and saves at 3 hours, with a warning 5 minutes before. */
export const LIMIT_MS = 3 * 60 * 60 * 1000;
export const WARNING_MS = LIMIT_MS - 5 * 60 * 1000;

/** How long transcribing takes per ms of sound on this computer, learned as pieces are done. */
export class WorkRate {
  private rate: number | null = null;

  add(workMs: number, soundMs: number): void {
    if (soundMs <= 0) return;
    const rate = workMs / soundMs;
    this.rate = this.rate === null ? rate : this.rate * 0.7 + rate * 0.3;
  }

  /** Null until a piece is done. */
  remaining(soundMs: number): number | null {
    return this.rate === null ? null : Math.round(this.rate * soundMs);
  }
}
