import { randomUUID } from 'node:crypto';
import { CreateAssignmentsRequestSchema, sampleStandardCourse } from '@carehub/learning';
import { getTableConfig } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../db/migrate';
import { createTestApp, createTestDatabase, hasDatabase, type TestApp } from '../../../testing';
import type { SendNoticeInput } from '../../notices';
import { sendReminders, type SentReminderRow } from './reminders';
import { learningRemindersSent, postgresReminderSources } from './reminders-store';
import { createAssignments } from './service';

// Fictional people and courses only.
const workspace = randomUUID();
const otherWorkspace = randomUUID();
const trainer = randomUUID();
const tara = randomUUID();
const omar = randomUUID();

describe.skipIf(!hasDatabase)('Learning reminders table', () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const database = await createTestDatabase();
    drop = database.drop;
    pool = new pg.Pool({ connectionString: database.url, max: 2 });
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await drop?.();
  });

  it('is created exactly as the Drizzle definition describes it', async () => {
    const config = getTableConfig(learningRemindersSent);
    const { rows } = await pool.query<{ name: string; type: string; not_null: boolean }>(
      `SELECT attname AS name, format_type(atttypid, atttypmod) AS type, attnotnull AS not_null
       FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped`,
      [config.name],
    );
    const inDatabase = Object.fromEntries(
      rows.map((row) => [row.name, { type: row.type, notNull: row.not_null }]),
    );
    const inDrizzle = Object.fromEntries(
      config.columns.map((column) => [
        column.name,
        { type: column.getSQLType(), notNull: column.notNull },
      ]),
    );
    expect(inDatabase).toEqual(inDrizzle);
  });

  it('refuses unknown kinds and bad course ids', async () => {
    const add = (courseId: string, kind: string) =>
      pool.query(
        `INSERT INTO learning_reminders_sent (workspace_id, user_id, course_id, kind, sent_on)
         VALUES ($1, $2, $3, $4, '2026-10-27')`,
        [workspace, tara, courseId, kind],
      );
    await expect(add('safe-lifting', 'weekly')).rejects.toThrow(/check constraint/);
    await expect(add('has spaces', 'assigned')).rejects.toThrow(/check constraint/);
    await add('safe-lifting', 'assigned');
  });
});

describe.skipIf(!hasDatabase)('postgresReminderSources', () => {
  let server: TestApp;

  beforeAll(async () => {
    server = await createTestApp();
  });

  afterAll(async () => {
    await server?.close();
  });

  it('logs each reminder once, per workspace and person', async () => {
    const reminders = postgresReminderSources(server.db);
    const assigned: SentReminderRow = {
      workspaceId: workspace,
      userId: tara,
      courseId: 'safe-lifting',
      kind: 'assigned',
      sentOn: '2026-10-27',
    };
    const overdue: SentReminderRow = { ...assigned, kind: 'overdue', sentOn: '2026-10-31' };

    expect(await reminders.logReminder(assigned)).toBe(true);
    expect(await reminders.logReminder(assigned)).toBe(false);
    expect(await reminders.logReminder(overdue)).toBe(true);
    await reminders.logReminder({ ...assigned, userId: omar });
    await reminders.logReminder({ ...assigned, workspaceId: otherWorkspace });

    const tarasLog = await reminders.sentReminders(workspace, [tara]);
    expect(tarasLog.sort((a, b) => a.sentOn.localeCompare(b.sentOn))).toEqual([assigned, overdue]);
    expect(await reminders.sentReminders(workspace, [tara, omar])).toHaveLength(3);
    expect(await reminders.sentReminders(workspace, [])).toEqual([]);
  });

  it('finds the workspaces with assignments and sends their reminders', async () => {
    const actor = { userId: trainer, workspaceId: workspace };
    const course = sampleStandardCourse;
    const notices: SendNoticeInput[] = [];
    const reminders = {
      ...postgresReminderSources(server.db),
      // Live courses come from the courses server (B1, #111); until it is on main, this one.
      liveCourses: async () => new Map([[course.id, course]]),
      canOpen: async () => false,
      sendNotice: async (notice: SendNoticeInput) => notices.push(notice),
    };
    const input = CreateAssignmentsRequestSchema.parse({
      target: { type: 'course', id: course.id },
      people: [tara],
      dueInDays: 7,
    });
    await createAssignments(reminders, actor, input, '2026-10-27');
    const workspaces = await reminders.workspaces();
    expect(workspaces.filter((id) => id === workspace)).toEqual([workspace]);
    const scoped = { ...reminders, workspaces: async () => [workspace] };

    const morning = new Date('2026-10-27T16:00:00Z');
    expect(await sendReminders(scoped, morning)).toBe(1);
    expect(await sendReminders(scoped, morning)).toBe(0);
    expect(notices).toEqual([
      {
        workspaceId: workspace,
        userId: tara,
        kind: 'reminder',
        sender: 'Learning',
        title: 'New course assigned',
        text: 'You have a new course to take, due in 7 days.',
        buttons: [{ label: 'Open course', href: `/learning/courses/${course.id}` }],
      },
    ]);
  });
});
