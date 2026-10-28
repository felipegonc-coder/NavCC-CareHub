import type { TemplateIcon } from '@carehub/extras/templates/gallery';
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../auth/schema';

// Mirrors migrations/202610271200_templates_gallery.sql, which is the source of truth (a test
// compares them).

const at = (name: string) => timestamp(name, { withTimezone: true });

export const tplTemplates = pgTable('tpl_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').notNull(),
  audience: text('audience', { enum: ['everyone', 'space', 'me'] }).notNull(),
  spaceId: uuid('space_id'),
  icon: jsonb('icon').$type<TemplateIcon>(),
  subPageCount: integer('sub_page_count').notNull().default(0),
  databaseCount: integer('database_count').notNull().default(0),
  sampleRowCount: integer('sample_row_count').notNull().default(0),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
  timesUsed: integer('times_used').notNull().default(0),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: at('updated_at').notNull().defaultNow(),
});

export const tplTemplatePages = pgTable(
  'tpl_template_pages',
  {
    templateId: uuid('template_id')
      .notNull()
      .references(() => tplTemplates.id, { onDelete: 'cascade' }),
    key: integer('key').notNull(),
    parentKey: integer('parent_key'),
    position: integer('position').notNull().default(0),
    kind: text('kind', { enum: ['page', 'database'] })
      .notNull()
      .default('page'),
    isInline: boolean('is_inline').notNull().default(false),
    title: text('title').notNull().default(''),
    icon: jsonb('icon').$type<TemplateIcon>(),
    markdown: text('markdown').notNull().default(''),
    sourcePageId: uuid('source_page_id'),
    rowCount: integer('row_count').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.templateId, table.key] })],
);

export const tplHiddenStarters = pgTable(
  'tpl_hidden_starters',
  {
    workspaceId: uuid('workspace_id').notNull(),
    starterKey: text('starter_key').notNull(),
    hiddenBy: uuid('hidden_by').references(() => users.id, { onDelete: 'set null' }),
    hiddenAt: at('hidden_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.starterKey] })],
);

export const tplMadeFrom = pgTable('tpl_made_from', {
  pageId: uuid('page_id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  templateId: uuid('template_id').references(() => tplTemplates.id, { onDelete: 'set null' }),
  starterKey: text('starter_key'),
  templateName: text('template_name').notNull(),
  usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
  usedAt: at('used_at').notNull().defaultNow(),
});

export type TemplateRow = typeof tplTemplates.$inferSelect;
export type TemplatePageRow = typeof tplTemplatePages.$inferSelect;
