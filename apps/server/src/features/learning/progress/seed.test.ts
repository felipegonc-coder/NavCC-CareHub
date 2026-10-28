import { randomUUID } from 'node:crypto';
import {
  sampleCertificationCourse,
  sampleMicrolearningCourse,
  sampleStandardCourse,
} from '@carehub/learning';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, hasDatabase, type TestApp } from '../../../testing';
import { learningCertificates } from '../certificates/schema';
import { seedCertificates } from '../certificates/seed';
import { seedCourses } from '../courses/seed';
import type { LearningSeed, SeedContext } from '../seed';
import { seedProgress } from './seed';
import { listCourseStates } from './service';

// The progress and certificate seeds on the database, after the sample courses. Fictional people
// only.
describe.skipIf(!hasDatabase)('Learning progress and certificate seeds', () => {
  let server: TestApp;

  beforeAll(async () => {
    server = await createTestApp();
  });

  afterAll(async () => {
    await server?.close();
  });

  it('finish three sample courses for the trainer, with one certificate, run twice', async () => {
    const workspaceId = randomUUID();
    const trainer = await createUser(server.db, { name: 'Tara Trainer' });
    const user = (name: string) => ({ id: randomUUID(), email: `${name}@example.test`, name });
    const ctx: SeedContext = {
      db: server.db,
      workspaceId,
      users: {
        admin: user('admin'),
        editor: user('editor'),
        commenter: user('commenter'),
        viewer: user('viewer'),
      },
      teamSpaceId: randomUUID(),
      log: server.app.log,
      createRole: async () => ({ id: 'role-unused' }),
      createPerson: async () => user('unused'),
    };
    const learning: LearningSeed = {
      trainer: { id: trainer.id, roleId: 'role-trainer' },
      reportViewer: { id: randomUUID(), roleId: 'role-reports' },
    };
    await seedCourses(ctx, learning);
    for (let run = 0; run < 2; run += 1) {
      await seedProgress(ctx, learning);
      await seedCertificates(ctx, learning);
    }

    const states = await listCourseStates(server.db, { workspaceId, userIds: [trainer.id] });
    expect(states.map((state) => [state.courseId, state.status]).sort()).toEqual(
      [
        [sampleStandardCourse.id, 'completed'],
        [sampleMicrolearningCourse.id, 'completed'],
        [sampleCertificationCourse.id, 'completed'],
      ].sort(),
    );
    const held = await server.db
      .select()
      .from(learningCertificates)
      .where(eq(learningCertificates.workspaceId, workspaceId));
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      learnerId: trainer.id,
      learnerName: 'Tara Trainer',
      courseId: sampleCertificationCourse.id,
    });
    expect(held[0]?.expiresOn).not.toBeNull();
  });
});
