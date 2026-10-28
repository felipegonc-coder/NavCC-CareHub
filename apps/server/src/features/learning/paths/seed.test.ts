import { randomUUID } from 'node:crypto';
import { sampleLearningPath } from '@carehub/learning';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, hasDatabase, type TestApp } from '../../../testing';
import type { LearningSeed, SeedContext } from '../seed';
import { seedPaths } from './seed';
import { getPath, listPaths } from './service';

// The paths seed on the database. Fictional people only.
describe.skipIf(!hasDatabase)('Learning paths seed', () => {
  let server: TestApp;

  beforeAll(async () => {
    server = await createTestApp();
  });

  afterAll(async () => {
    await server?.close();
  });

  it('adds the sample path once, made by the trainer, when run twice', async () => {
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
    await seedPaths(ctx, learning);
    await seedPaths(ctx, learning);

    const listed = await listPaths(server.db, workspaceId);
    expect(listed.map((path) => [path.id, path.courseCount])).toEqual([
      [sampleLearningPath.id, sampleLearningPath.courseIds.length],
    ]);
    expect(await getPath(server.db, workspaceId, sampleLearningPath.id)).toMatchObject({
      id: sampleLearningPath.id,
      title: sampleLearningPath.title,
      courseIds: [...sampleLearningPath.courseIds],
      order: sampleLearningPath.order,
    });
  });
});
