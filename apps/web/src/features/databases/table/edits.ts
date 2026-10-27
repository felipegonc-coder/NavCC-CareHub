import type { SelectOption } from '@carehub/databases';

/** Same stored value (both empty counts as the same). */
export const sameStored = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * A Select or Multi-select value without the options typed into the editor that the property
 * doesn't have yet (CommitDetails.newOptions): until the view can add options they're left out,
 * and a Select keeps the value it had (`before`).
 */
export function withoutNewOptions(
  value: unknown,
  before: unknown,
  newOptions?: readonly SelectOption[],
): unknown {
  if (!newOptions || newOptions.length === 0) return value;
  const made = new Set(newOptions.map((o) => o.id));
  if (typeof value === 'string') return made.has(value) ? before : value;
  if (Array.isArray(value)) {
    const kept = value.filter((id) => !(typeof id === 'string' && made.has(id)));
    return kept.length > 0 ? kept : null;
  }
  return value;
}
