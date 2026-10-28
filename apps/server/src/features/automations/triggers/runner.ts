/**
 * The parts of the runner (running.ts) the triggers use, declared here until it's on main. The
 * run's job starts the run under its key (one run per event), counts the hourly limit, logs an
 * arrival an hour late or more as Missed (AU-05), checks the owner and retries.
 */
import type { RunSource } from '@carehub/team-automations/automation';
import type { Automation } from '../domain/types';

export interface TriggeredRun {
  kind: 'triggered';
  /** One run per key and automation: `response:<response id>`, `date:<row id>:<arrival>`. */
  key: string;
  source: RunSource;
  /** Who responded; null for anonymous forms and for Date arrives. */
  triggeredBy: string | null;
  /** Date arrives: the arrival time. Null for the others. */
  plannedFor: Date | null;
}

/** `runner.queueRun`. Queuing the same event twice is safe: the job and the run are keyed. */
export type QueueRun = (
  automation: Automation,
  run: TriggeredRun,
) => Promise<{ jobId: string; created: boolean }>;

/**
 * `runner.actingOwner`: its owner, checked now. Null when the owner left or isn't an Admin anymore,
 * and by then it's paused and the Admins have been told. Throws when the members can't be read.
 */
export type ActingOwner = (
  automation: Automation,
) => Promise<{ owner: { userId: string; name: string } } | null>;

/** `runner.pause`: switches it off with the reason ("Paused: …") and tells the Admins and the owner. */
export type PauseAutomation = (automation: Automation, reason: string) => Promise<void>;
