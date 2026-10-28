import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDatabase, type TestApp } from '../../testing';
import { msgChats, msgMembers, msgMessages } from './schema';

interface Column {
  name: string;
  type: string;
  notNull: boolean;
}

const byName = (columns: Column[]) =>
  [...columns].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

describe.skipIf(!hasDatabase)('messages schema', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('matches the migration: every column, its type and whether it can be null', async () => {
    for (const table of [msgChats, msgMembers, msgMessages]) {
      const config = getTableConfig(table);
      const result = await testApp.db.execute(sql`
        SELECT attname AS name, format_type(atttypid, atttypmod) AS type, attnotnull AS "notNull"
        FROM pg_attribute
        WHERE attrelid = ${config.name}::regclass AND attnum > 0 AND NOT attisdropped`);
      const inDatabase = (result.rows as unknown as Column[]).map(({ name, type, notNull }) => ({
        name,
        type,
        notNull,
      }));
      const inDrizzle = config.columns.map((column) => ({
        name: column.name,
        type: column.getSQLType(),
        notNull: column.notNull,
      }));
      expect({ table: config.name, columns: byName(inDrizzle) }).toEqual({
        table: config.name,
        columns: byName(inDatabase),
      });
    }
  });
});
