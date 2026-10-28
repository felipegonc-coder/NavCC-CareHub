import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { memberOf, pageFor } from './access';

const withMember = (member: unknown) => ({ member }) as unknown as FastifyRequest;
const workspaceId = 'f1b0c7de-0000-4000-8000-000000000001';

describe('writing help access stand-ins', () => {
  it('give Use Claude only to members whose role has it, never to guests', () => {
    const has = new Set(['pages.edit', 'claude.use']);
    expect(memberOf(withMember({ kind: 'member', workspaceId, permissions: has }))).toEqual({
      workspaceId,
      canUseClaude: true,
    });
    expect(
      memberOf(withMember({ kind: 'member', workspaceId, permissions: new Set(['pages.edit']) })),
    ).toEqual({ workspaceId, canUseClaude: false });
    expect(memberOf(withMember({ kind: 'guest', workspaceId, permissions: has }))).toEqual({
      workspaceId,
      canUseClaude: false,
    });
    expect(
      memberOf(withMember({ kind: 'member', workspaceId, permissions: ['claude.use'] })),
    ).toEqual({ workspaceId, canUseClaude: false });
  });

  it('find nobody and no page until accounts and the page model are bound', async () => {
    expect(memberOf(withMember(undefined))).toBeNull();
    expect(memberOf({} as FastifyRequest)).toBeNull();
    expect(await pageFor({} as never, 'someone', 'some-page')).toBeNull();
  });
});
