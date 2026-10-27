import { randomUUID } from 'node:crypto';
import { sampleCourses } from '@carehub/learning';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDatabase, type TestApp } from '../../testing';
import { listStudioCourses } from './courses/service';
import { seed, TRAINER_PERMISSIONS, type SeedContext } from './seed';

describe('Learning seed', () => {
  it("gives the trainer Editor's keys and all three Learning keys, never admin", () => {
    const editor = [
      'pages.edit',
      'pages.create',
      'pages.comment',
      'pages.share',
      'templates.manage',
      'claude.use',
      'guests.add',
      'pages.shareLinks',
    ];
    expect([...TRAINER_PERMISSIONS].sort()).toEqual(
      [...editor, 'learning.build', 'learning.assign', 'learning.analytics'].sort(),
    );
    expect(TRAINER_PERMISSIONS).not.toContain('workspace.admin');
  });
});

describe.skipIf(!hasDatabase)('Learning seed data', () => {
  let server: TestApp;

  beforeAll(async () => {
    server = await createTestApp();
  });

  afterAll(async () => {
    await server?.close();
  });

  function seedContext(trainerId: string) {
    const calls: string[] = [];
    const person = () => ({ id: randomUUID() });
    const ctx: SeedContext = {
      db: server.db,
      workspaceId: randomUUID(),
      users: { admin: person(), editor: person(), commenter: person(), viewer: person() },
      teamSpaceId: randomUUID(),
      log: (message) => calls.push(`log ${message}`),
      createRole: async (role) => {
        calls.push(`role ${role.name} ${role.permissions.join(',')}`);
        return { id: 'role-trainer' };
      },
      createPerson: async (added) => {
        calls.push(`person ${added.key} ${added.name} ${added.email} ${added.roleId}`);
        return { id: trainerId };
      },
    };
    return { ctx, calls };
  }

  it('adds the Trainer role, Tara Trainer and the sample courses, then says so', async () => {
    const trainerId = randomUUID();
    const { ctx, calls } = seedContext(trainerId);
    await seed(ctx);
    expect(calls).toEqual([
      `role Trainer ${TRAINER_PERMISSIONS.join(',')}`,
      'person trainer Tara Trainer tara.trainer@example.test role-trainer',
      `log Learning: added ${sampleCourses.length} sample courses.`,
      'log Learning: added the Trainer role and Tara Trainer (tara.trainer@example.test).',
    ]);

    const trainer = { userId: trainerId, workspaceId: ctx.workspaceId };
    const studio = await listStudioCourses(ctx.db, trainer, { archived: false });
    expect(studio.map((course) => course.id).sort()).toEqual(
      sampleCourses.map((course) => course.id).sort(),
    );
    for (const course of studio) expect(course).toMatchObject({ state: 'live', version: 1 });
  });
});
