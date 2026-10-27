/** A notice with the same group key within this long of the last one updates it instead. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** The person's latest notice with the same group key in the same workspace. */
export interface GroupCandidate {
  id: string;
  latestAt: Date;
  count: number;
}

export type NoticePlan =
  | { type: 'insert' }
  /** Update `noticeId` in place: new content, unread again, moved to latest, this count. */
  | { type: 'group'; noticeId: string; count: number };

/**
 * Whether a new notice joins `candidate` or becomes a notice of its own. The window counts from
 * the candidate's latest arrival, so a steady trickle keeps grouping. A candidate from the future
 * (clock skew) still groups.
 */
export function planNotice(candidate: GroupCandidate | null, now: Date): NoticePlan {
  if (!candidate || now.getTime() - candidate.latestAt.getTime() >= GROUP_WINDOW_MS) {
    return { type: 'insert' };
  }
  return { type: 'group', noticeId: candidate.id, count: candidate.count + 1 };
}

/**
 * The text the store hashes into a transaction-level advisory lock, so two notices with the same
 * key for the same person can't both be added at the same moment.
 */
export function groupLockKey(notice: {
  workspaceId: string;
  userId: string;
  groupKey: string;
}): string {
  return `notices:${notice.workspaceId}:${notice.userId}:${notice.groupKey}`;
}
