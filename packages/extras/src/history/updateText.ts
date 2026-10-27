// How Updates read (section 3.3; HT-08): entries grouped per person and hour, newest first, under
// the person's name, as "edited · 3 changes" or "changed Status: Open → Done". Times are in
// `timeZone` (the browser's when left out).
import type { HistoryPerson } from './api';
import { versionDate } from './format';
import type { UpdateEntry, UpdatePlace } from './updates';

export interface UpdateGroup {
  /** The person and the hour. */
  key: string;
  /** Null for an automation or someone no longer known: "Someone". */
  by: HistoryPerson | null;
  /** When the newest entry happened. */
  at: string;
  /** Newest first. */
  updates: UpdateEntry[];
}

function hourOf(at: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(at));
}

/** Groups entries (newest first) per person and hour; each group sits at its newest entry. */
export function groupUpdates(updates: readonly UpdateEntry[], timeZone?: string): UpdateGroup[] {
  const groups = new Map<string, UpdateGroup>();
  for (const update of updates) {
    const key = `${update.by?.id ?? 'someone'} ${hourOf(update.at, timeZone)}`;
    const group = groups.get(key);
    if (group) group.updates.push(update);
    else groups.set(key, { key, by: update.by, at: update.at, updates: [update] });
  }
  return [...groups.values()];
}

/** The name a group shows. */
export function updatePerson(by: HistoryPerson | null): string {
  return by?.name || 'Someone';
}

function place(where: UpdatePlace): string {
  if (where.kind === 'top') return 'the top of the space';
  if (where.kind === 'hidden') return "a page you can't open";
  return where.title || 'Untitled';
}

const FIXED: Record<UpdateEntry['kind'], string> = {
  created: 'created the page',
  edited: 'edited',
  renamed: 'renamed the page',
  moved: 'moved the page',
  shared: 'changed who has access',
  locked: 'locked the page',
  unlocked: 'unlocked the page',
  commented: 'commented',
  suggestion_accepted: 'accepted a suggestion',
  property_changed: 'changed a property',
  restored: 'restored a version',
  archived: 'archived the page',
  unarchived: 'unarchived the page',
  trashed: 'moved the page to Trash',
  untrashed: 'restored the page from Trash',
};

/** What the person did, after their name: "edited · 3 changes". */
export function updateText(update: UpdateEntry, now = new Date(), timeZone?: string): string {
  const { changes, title, move, property, restoredFrom } = update;
  switch (update.kind) {
    case 'edited':
      return changes ? `edited · ${changes} ${changes === 1 ? 'change' : 'changes'}` : 'edited';
    case 'renamed':
      return title
        ? `renamed the page from “${title.from || 'Untitled'}” to “${title.to || 'Untitled'}”`
        : FIXED.renamed;
    case 'moved':
      return move ? `moved the page from ${place(move.from)} to ${place(move.to)}` : FIXED.moved;
    case 'commented':
      return update.reply ? 'replied to a comment' : FIXED.commented;
    case 'property_changed':
      return property
        ? `changed ${property.name}: ${property.from || 'Empty'} → ${property.to || 'Empty'}`
        : FIXED.property_changed;
    case 'restored':
      return restoredFrom
        ? `restored a version from ${versionDate(restoredFrom, now, timeZone)}`
        : FIXED.restored;
    default:
      return FIXED[update.kind];
  }
}
