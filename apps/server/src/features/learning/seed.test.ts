import { describe, expect, it } from 'vitest';
import { seed, TRAINER_PERMISSIONS, type SeedContext } from './seed';

function fakeContext() {
  const calls: string[] = [];
  const ctx: SeedContext = {
    db: {},
    workspaceId: 'ws-1',
    users: {
      admin: { id: 'u-a' },
      editor: { id: 'u-e' },
      commenter: { id: 'u-c' },
      viewer: { id: 'u-v' },
    },
    teamSpaceId: 'space-1',
    log: (message) => calls.push(`log ${message}`),
    createRole: async (role) => {
      calls.push(`role ${role.name} ${role.permissions.join(',')}`);
      return { id: 'role-trainer' };
    },
    createPerson: async (person) => {
      calls.push(`person ${person.key} ${person.name} ${person.email} ${person.roleId}`);
      return { id: 'u-trainer' };
    },
  };
  return { ctx, calls };
}

describe('Learning seed', () => {
  it('adds the Trainer role and Tara Trainer, then says so', async () => {
    const { ctx, calls } = fakeContext();
    await seed(ctx);
    expect(calls).toEqual([
      `role Trainer ${TRAINER_PERMISSIONS.join(',')}`,
      'person trainer Tara Trainer tara.trainer@example.test role-trainer',
      'log Learning: added the Trainer role and Tara Trainer (tara.trainer@example.test).',
    ]);
  });

  it("gives the trainer Editor's keys and all three Learning keys, never admin", () => {
    const editor = [
      'pages.edit',
      'pages.create',
      'pages.comment',
      'pages.share',
      'templates.manage',
    ];
    for (const key of [...editor, 'learning.build', 'learning.assign', 'learning.analytics'])
      expect(TRAINER_PERMISSIONS).toContain(key);
    expect(TRAINER_PERMISSIONS).not.toContain('workspace.admin');
  });
});
