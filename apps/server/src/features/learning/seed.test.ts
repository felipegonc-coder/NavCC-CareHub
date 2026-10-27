import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SeedContext } from '../../seed';
import { createTestApp, hasDatabase, type TestApp } from '../../testing';
import { REPORT_VIEWER_PERMISSIONS, seed, seedPeople, TRAINER_PERMISSIONS } from './seed';

/** Core's role and person helpers, recording what they're asked for. */
function corePeople() {
  const calls: string[] = [];
  const ids = new Map<string, string>();
  return {
    calls,
    ids,
    createRole: async (role: { name: string; permissions: readonly string[] }) => {
      calls.push(`role ${role.name} ${role.permissions.join(',')}`);
      return { id: `role-${calls.length}` };
    },
    createPerson: async (person: { key: string; name: string; email: string; roleId: string }) => {
      calls.push(`person ${person.key} ${person.name} ${person.email} ${person.roleId}`);
      const id = randomUUID();
      ids.set(person.key, id);
      return { id, email: person.email, name: person.name };
    },
  };
}

describe('Learning seed', () => {
  it('adds the Trainer and Report viewer roles, each with its person', async () => {
    const people = corePeople();
    const learning = await seedPeople(people);
    expect(people.calls).toEqual([
      `role Trainer ${TRAINER_PERMISSIONS.join(',')}`,
      'person trainer Tara Trainer tara.trainer@example.test role-1',
      'role Report viewer learning.analytics',
      'person reports Remy Reports remy.reports@example.test role-3',
    ]);
    expect(learning).toEqual({
      trainer: { id: people.ids.get('trainer'), roleId: 'role-1' },
      reportViewer: { id: people.ids.get('reports'), roleId: 'role-3' },
    });
  });

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

  it('gives the report viewer the reports key only', () => {
    expect(REPORT_VIEWER_PERMISSIONS).toEqual(['learning.analytics']);
  });
});

describe.skipIf(!hasDatabase)('Learning seed on the database', () => {
  let server: TestApp;

  beforeAll(async () => {
    server = await createTestApp();
  });

  afterAll(async () => {
    await server?.close();
  });

  it("runs every area's seed on core's seed context, twice", async () => {
    const people = corePeople();
    const user = (name: string) => ({ id: randomUUID(), email: `${name}@example.test`, name });
    const ctx: SeedContext = {
      db: server.db,
      workspaceId: randomUUID(),
      users: {
        admin: user('admin'),
        editor: user('editor'),
        commenter: user('commenter'),
        viewer: user('viewer'),
      },
      teamSpaceId: randomUUID(),
      log: server.app.log,
      createRole: people.createRole,
      createPerson: people.createPerson,
    };
    await seed(ctx);
    await seed(ctx);
    expect(people.calls).toHaveLength(8);
  });
});
