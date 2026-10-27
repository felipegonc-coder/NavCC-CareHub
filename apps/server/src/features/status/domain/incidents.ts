// Incidents: gaps in the heartbeats, recorded when heartbeats resume (Status page spec, section 3).
import type { MinuteSpan } from './uptime';

export type IncidentCause = 'update' | 'restart' | 'unknown';

/** How the previous server run ended, from the server's own record. */
export interface PreviousRun {
  version: string;
  /** It shut down in order (as Docker restarts and updates do), not a crash or power cut. */
  stoppedCleanly: boolean;
}

/** The minutes missed between the last heartbeat and this one, or null if none were. */
export function missedMinutes(lastBeat: number | null, beat: number): MinuteSpan | null {
  if (lastBeat === null || beat - lastBeat <= 1) return null;
  return { start: lastBeat + 1, end: beat };
}

/**
 * Why heartbeats stopped. A gap that ends while the server keeps running (it couldn't reach the
 * database) has no known cause. A gap that ends as the server starts is an update when the version
 * changed, and a restart when the previous run shut down in order.
 */
export function incidentCause(gap: {
  endsAtStart: boolean;
  previous: PreviousRun | null;
  version: string;
}): IncidentCause {
  if (!gap.endsAtStart || !gap.previous) return 'unknown';
  if (gap.previous.version !== gap.version) return 'update';
  return gap.previous.stoppedCleanly ? 'restart' : 'unknown';
}
