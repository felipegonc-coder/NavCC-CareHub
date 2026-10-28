import { describe, expect, it } from 'vitest';
import type { Db } from '../../../db';
import { bindClaudeMembers, configureClaude } from '../index';
import { pageFor, writerOf } from './access';

const db = {} as Db;
const workspaceId = 'f1b0c7de-0000-4000-8000-000000000001';

describe('writing help access', () => {
  it("lets in members with Use Claude, through the Claude core's lookups", async () => {
    const asked: string[] = [];
    const unbind = [
      bindClaudeMembers(async (_db, userId) =>
        userId === 'gia' ? null : { workspaceId, isAdmin: false },
      ),
      configureClaude({
        access: {
          isSettingOn: async () => true,
          canUseClaude: async (_db, id, userId) => {
            asked.push(`${id} ${userId}`);
            return userId === 'avery';
          },
        },
      }),
    ];
    try {
      expect(await writerOf(db, 'avery')).toEqual({ workspaceId });
      expect(await writerOf(db, 'sam')).toBeNull();
      // A guest isn't a member, so Use Claude isn't even asked.
      expect(await writerOf(db, 'gia')).toBeNull();
      expect(asked).toEqual([`${workspaceId} avery`, `${workspaceId} sam`]);
    } finally {
      for (const done of unbind) done();
    }
  });

  it('finds nobody and no page until roles and the page model are bound', async () => {
    expect(await writerOf(db, 'avery')).toBeNull();
    expect(await pageFor(db, 'avery', 'some-page')).toBeNull();
  });
});
