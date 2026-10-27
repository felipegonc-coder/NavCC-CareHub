import type { FormatIssue } from './issues';

/**
 * Upgrades a stored document from `formatVersion` `from` to `from + 1`. It gets the raw document (already
 * checked to be an object) and must return a new object without changing its input. The runner then sets
 * `formatVersion` to `from + 1`.
 */
export type Migration = {
  from: number;
  up: (doc: Record<string, unknown>) => Record<string, unknown>;
};

/** Course migrations, oldest first. Empty while the format is at version 1. */
export const COURSE_MIGRATIONS: readonly Migration[] = [];

/** Learning path migrations, oldest first. Empty while paths are at version 1. */
export const LEARNING_PATH_MIGRATIONS: readonly Migration[] = [];

export type MigrationResult =
  { ok: true; value: unknown; migratedFrom?: number } | { ok: false; issues: FormatIssue[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Brings `raw` up to `current` by running `migrations` one version at a time. Anything that isn't an
 * object with a whole-number `formatVersion` is passed through untouched, so the schema can say what's wrong.
 */
export function runMigrations(
  raw: unknown,
  current: number,
  migrations: readonly Migration[],
  what: string,
): MigrationResult {
  if (!isRecord(raw)) return { ok: true, value: raw };
  const start = raw.formatVersion;
  if (typeof start !== 'number' || !Number.isInteger(start) || start === current)
    return { ok: true, value: raw };
  if (start > current) {
    return {
      ok: false,
      issues: [
        {
          path: 'formatVersion',
          message: `This ${what} uses format version ${start}, which is newer than this Care Hub understands (${current}). Update Care Hub and try again.`,
        },
      ],
    };
  }
  let doc: Record<string, unknown> = raw;
  for (let version = start; version < current; version++) {
    const migration = migrations.find((m) => m.from === version);
    if (!migration)
      return {
        ok: false,
        issues: [
          { path: 'formatVersion', message: `Format version ${version} can't be upgraded.` },
        ],
      };
    try {
      const next = migration.up(doc);
      if (!isRecord(next)) throw new TypeError('migration returned a non-object');
      doc = { ...next, formatVersion: version + 1 };
    } catch {
      return {
        ok: false,
        issues: [
          { path: '', message: `Upgrading this ${what} from format version ${version} failed.` },
        ],
      };
    }
  }
  return { ok: true, value: doc, migratedFrom: start };
}
