// The version list's grouping and keys (section 2 and 6): grouped by day, newest first; ↑ and ↓
// move, Home and End jump.
import { versionDay, type VersionSummary } from '@carehub/extras/history';

export interface DayGroup {
  /** "Today", "Yesterday" or "Oct 20". */
  day: string;
  versions: VersionSummary[];
}

/** Splits versions (newest first) into days, in order. */
export function groupByDay(
  versions: readonly VersionSummary[],
  now = new Date(),
  timeZone?: string,
): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const version of versions) {
    const day = versionDay(version.createdAt, now, timeZone);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.versions.push(version);
    else groups.push({ day, versions: [version] });
  }
  return groups;
}

/**
 * Where a key moves the selection in a list of `count`, from `index` (-1 when nothing in the list
 * is selected); null for other keys.
 */
export function stepIndex(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  const last = count - 1;
  switch (key) {
    case 'ArrowDown':
      return Math.min(index + 1, last);
    case 'ArrowUp':
      return Math.max(index - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}
