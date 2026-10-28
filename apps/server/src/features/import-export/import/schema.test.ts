import { IMPORT_SOURCE_IDS } from '@carehub/extras/import-export/import/index';
import { getTableConfig } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../db/migrate';
import { createTestDatabase, hasDatabase } from '../../../testing';
import { IMPORT_STATUSES, ITEM_KINDS, ieImportItems, ieImportUploads, ieImports } from './schema';

describe.skipIf(!hasDatabase)('Import tables', () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let userId: string;

  beforeAll(async () => {
    const database = await createTestDatabase();
    drop = database.drop;
    pool = new pg.Pool({ connectionString: database.url, max: 2 });
    await runMigrations(pool);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name) VALUES ('importer@example.test', 'Test Importer') RETURNING id`,
    );
    userId = rows[0]?.id ?? '';
  });

  afterAll(async () => {
    await pool?.end();
    await drop?.();
  });

  it('are created exactly as the Drizzle definitions describe them', async () => {
    for (const table of [ieImports, ieImportUploads, ieImportItems]) {
      const config = getTableConfig(table);
      const { rows } = await pool.query<{
        name: string;
        type: string;
        not_null: boolean;
        has_default: boolean;
      }>(
        `SELECT attname AS name, format_type(atttypid, atttypmod) AS type,
                attnotnull AS not_null, atthasdef AS has_default
         FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped`,
        [config.name],
      );
      const inDatabase = Object.fromEntries(
        rows.map((row) => [
          row.name,
          { type: row.type, notNull: row.not_null, hasDefault: row.has_default },
        ]),
      );
      const inDrizzle = Object.fromEntries(
        config.columns.map((column) => [
          column.name,
          { type: column.getSQLType(), notNull: column.notNull, hasDefault: column.hasDefault },
        ]),
      );
      expect(inDatabase, config.name).toEqual(inDrizzle);
    }
  });

  const addImport = (values: { source?: string; status?: string; pageId?: string | null }) =>
    pool.query<{ id: string }>(
      `INSERT INTO ie_imports (workspace_id, user_id, source, file_name, file_size, page_id,
         space_id, status)
       VALUES ('00000000-0000-4000-8000-000000000001', $1, $2, 'notes.md', 12, $3, NULL, $4)
       RETURNING id`,
      [
        userId,
        values.source ?? 'markdown',
        values.pageId === undefined ? '00000000-0000-4000-8000-000000000002' : values.pageId,
        values.status ?? 'uploading',
      ],
    );

  it('take every source, status and kind the code knows, and nothing else', async () => {
    for (const source of IMPORT_SOURCE_IDS) await addImport({ source });
    for (const status of IMPORT_STATUSES) await addImport({ status });
    await expect(addImport({ source: 'dropbox' })).rejects.toThrow(/check/);
    await expect(addImport({ status: 'paused' })).rejects.toThrow(/check/);
    await expect(addImport({ pageId: null })).rejects.toThrow(/check/);

    const { rows } = await addImport({});
    const importId = rows[0]?.id;
    for (const [position, kind] of ITEM_KINDS.entries()) {
      await pool.query(
        `INSERT INTO ie_import_items (import_id, page_id, kind, position)
         VALUES ($1, gen_random_uuid(), $2, $3)`,
        [importId, kind, position],
      );
    }
    await expect(
      pool.query(
        `INSERT INTO ie_import_items (import_id, page_id, kind, position)
         VALUES ($1, gen_random_uuid(), 'space', 9)`,
        [importId],
      ),
    ).rejects.toThrow(/check/);
  });

  it('remove uploads and items with their import', async () => {
    const { rows } = await addImport({});
    const importId = rows[0]?.id;
    await pool.query(`INSERT INTO ie_import_uploads (import_id, bytes) VALUES ($1, '\\x01')`, [
      importId,
    ]);
    await pool.query(
      `INSERT INTO ie_import_items (import_id, page_id, kind, position)
       VALUES ($1, gen_random_uuid(), 'page', 0)`,
      [importId],
    );
    await pool.query(`DELETE FROM ie_imports WHERE id = $1`, [importId]);
    const left = await pool.query(
      `SELECT (SELECT count(*) FROM ie_import_uploads WHERE import_id = $1) AS uploads,
              (SELECT count(*) FROM ie_import_items WHERE import_id = $1) AS items`,
      [importId],
    );
    expect(left.rows[0]).toEqual({ uploads: '0', items: '0' });
  });
});
