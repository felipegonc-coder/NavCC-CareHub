import type { QuestionBank } from '@carehub/learning';
import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migrations/202610270800_learning_banks.sql, the source of truth (store.test.ts compares them).

const at = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();

/** Each workspace's question banks, with the revision the next save must name (decision 0304). */
export const learningBanks = pgTable(
  'learning_banks',
  {
    workspaceId: uuid('workspace_id').notNull(),
    id: text('id').notNull(),
    bank: jsonb('bank').$type<QuestionBank>().notNull(),
    revision: integer('revision').notNull().default(1),
    createdBy: uuid('created_by').notNull(),
    createdAt: at('created_at'),
    updatedAt: at('updated_at'),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.id] })],
);
