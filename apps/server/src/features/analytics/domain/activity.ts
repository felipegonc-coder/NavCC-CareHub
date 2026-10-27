// What Analytics records, and what counts once (Analytics spec, sections 3 and 4).

const MINUTE_MS = 60_000;

/** Opening, changing, making, deleting (to the Trash) and restoring a page, database or row. */
export const ACTIVITY_KINDS = ['view', 'edit', 'create', 'delete', 'restore'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * Repeats by the same person on the same page within this time count once: opens within 30
 * minutes (AN-01) and changes within 10 minutes (AN-02). The time runs from the one that counted,
 * so the next one counts once it has passed. The other kinds always count.
 */
export const COUNT_ONCE_MS = {
  view: 30 * MINUTE_MS,
  edit: 10 * MINUTE_MS,
} as const satisfies Partial<Record<ActivityKind, number>>;

export function countOnceWindow(kind: ActivityKind): number {
  return kind === 'view' || kind === 'edit' ? COUNT_ONCE_MS[kind] : 0;
}

/** Who did it: a person, or Care Hub on someone's behalf. */
export type Actor = 'person' | 'automation' | 'import';

export interface ActivityContext {
  actor: Actor;
  /** The page is in someone's private space. */
  privateSpace: boolean;
  /** The page was in the Trash before this happened. */
  inTrash: boolean;
}

/**
 * Whether Analytics records this at all. Only people's own actions count, never automations or
 * imports (AN-09); an import is recorded once, as one edit of its database by the person who ran
 * it. Nothing is recorded for private spaces (AN-03). Pages in the Trash don't count, except being
 * restored from it.
 */
export function isRecorded(kind: ActivityKind, context: ActivityContext): boolean {
  if (context.actor !== 'person' || context.privateSpace) return false;
  return context.inTrash ? kind === 'restore' : true;
}
