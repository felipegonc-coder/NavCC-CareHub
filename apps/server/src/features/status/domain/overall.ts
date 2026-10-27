// The overall status from the part checks (Status page spec, section 3).

/**
 * The parts site admins see, in screen order: web app and server, database, file storage, live
 * editing, background jobs (reminders and automations) and calendar sync.
 */
export const PARTS = ['server', 'database', 'files', 'collab', 'jobs', 'calendar'] as const;
export type Part = (typeof PARTS)[number];

/** `problem`: working, but needs attention (low disk space). `unknown`: not checked (yet). */
export type PartState = 'ok' | 'problem' | 'down' | 'unknown';
export type OverallStatus = 'working' | 'some_problems' | 'down';

/** Under 15% free disk space, file storage is a problem (Some problems overall)... */
export const LOW_DISK_SHARE = 0.15;
/** ...and under 10%, site admins get a notice. */
export const NOTICE_DISK_SHARE = 0.1;

/**
 * Down when the server or the database isn't working; Some problems when any other part is down or
 * has a problem; Working otherwise. Parts that aren't checked don't count.
 */
export function overallStatus(states: Partial<Record<Part, PartState>>): OverallStatus {
  if (states.server === 'down' || states.database === 'down') return 'down';
  const failing = Object.values(states).some((state) => state === 'down' || state === 'problem');
  return failing ? 'some_problems' : 'working';
}

export interface FileStorageCheck {
  /** The files folder exists and the server can write to it. */
  writable: boolean;
  freeBytes: number;
  totalBytes: number;
}

/** Free disk space as a share of the disk (0 to 1). */
export function freeShare(check: FileStorageCheck): number {
  return check.totalBytes > 0 ? Math.max(0, check.freeBytes) / check.totalBytes : 0;
}

/** File storage is down when files can't be written, and a problem under 15% free disk space. */
export function fileStorageState(check: FileStorageCheck): PartState {
  if (!check.writable || check.totalBytes <= 0) return 'down';
  return freeShare(check) < LOW_DISK_SHARE ? 'problem' : 'ok';
}
