import {
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// Mirrors migrations/202610270700_learning_certificates.sql, which is the source of truth
// (schema.test.ts compares them).

const day = (name: string) => date(name, { mode: 'string' });

/** One certificate: a learner's finish of a course version, with its verification code. */
export const learningCertificates = pgTable(
  'learning_certificates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    code: text('code').notNull().unique(),
    learnerId: uuid('learner_id').notNull(),
    learnerName: text('learner_name').notNull(),
    courseId: text('course_id').notNull(),
    courseTitle: text('course_title').notNull(),
    courseVersion: integer('course_version').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
    issuedOn: day('issued_on').notNull(),
    expiresOn: day('expires_on'),
    score: doublePrecision('score'),
    reassignedOn: day('reassigned_on'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.workspaceId, table.learnerId, table.courseId, table.completedAt),
    index('learning_certificates_course_idx').on(table.workspaceId, table.courseId),
  ],
);

/** The expiry notices sent for a certificate: "expiring_soon" and "expired", once each. */
export const learningCertificateNotices = pgTable(
  'learning_certificate_notices',
  {
    certificateId: uuid('certificate_id')
      .notNull()
      .references(() => learningCertificates.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'expiring_soon' | 'expired'>().notNull(),
    sentOn: day('sent_on').notNull(),
  },
  (table) => [primaryKey({ columns: [table.certificateId, table.kind] })],
);
