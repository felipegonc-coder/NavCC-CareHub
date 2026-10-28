/**
 * How far each Date arrives automation's dates have been checked: every arrival up to that time
 * has been handled. Kept in automations_date_checks, so after a restart the check picks up where
 * it stopped and can tell late arrivals from missed ones (AU-05).
 */
import type { SqlRunner } from '../store';

export interface DateChecks {
  /** The times checked up to; automations never checked are left out. */
  load(automationIds: readonly string[]): Promise<Map<string, Date>>;
  save(automationId: string, until: Date): Promise<void>;
  /** Forgets every other automation (switched off, deleted, or with another trigger now). */
  keepOnly(automationIds: readonly string[]): Promise<void>;
}

/** In memory, for unit tests. */
export function createMemoryDateChecks(): DateChecks {
  const checked = new Map<string, Date>();
  return {
    async load(ids) {
      const found = new Map<string, Date>();
      for (const id of ids) {
        const until = checked.get(id);
        if (until) found.set(id, new Date(until));
      }
      return found;
    },
    async save(id, until) {
      checked.set(id, new Date(until));
    },
    async keepOnly(ids) {
      for (const id of [...checked.keys()]) if (!ids.includes(id)) checked.delete(id);
    },
  };
}

export function createPostgresDateChecks(db: SqlRunner): DateChecks {
  return {
    async load(ids) {
      if (ids.length === 0) return new Map();
      const { rows } = await db.query<{ id: string; until: Date | string }>(
        `SELECT automation_id::text AS id, checked_until AS until FROM automations_date_checks
         WHERE automation_id = ANY($1::uuid[])`,
        [ids],
      );
      return new Map(rows.map((row) => [row.id, new Date(row.until)]));
    },
    async save(id, until) {
      // Only while the automation is there: a deleted one takes its row with it.
      await db.query(
        `INSERT INTO automations_date_checks (automation_id, checked_until)
         SELECT id, $2::timestamptz FROM automations_automations WHERE id = $1::uuid
         ON CONFLICT (automation_id) DO UPDATE SET checked_until = EXCLUDED.checked_until`,
        [id, until.toISOString()],
      );
    },
    async keepOnly(ids) {
      await db.query(
        'DELETE FROM automations_date_checks WHERE NOT (automation_id = ANY($1::uuid[]))',
        [ids],
      );
    },
  };
}
