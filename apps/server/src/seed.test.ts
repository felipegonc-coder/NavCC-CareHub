import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { assertSeedAllowed, seedFeatures, type SeedContext } from './seed';

function fakeContext(): SeedContext {
  const person = { id: 'user-1', email: 'eli.editor@example.test', name: 'Eli Editor' };
  return {
    db: {} as SeedContext['db'],
    workspaceId: 'workspace-1',
    users: { admin: person, editor: person, commenter: person, viewer: person },
    teamSpaceId: 'space-1',
    log: { info: vi.fn() } as unknown as FastifyBaseLogger,
    createRole: vi.fn(),
    createPerson: vi.fn(),
  };
}

describe('seed', () => {
  it('never runs in production', async () => {
    const ctx = fakeContext();
    await expect(seedFeatures(ctx, { NODE_ENV: 'production' })).rejects.toThrow(/production/);
    expect(ctx.log.info).not.toHaveBeenCalled();
    expect(() => assertSeedAllowed({ NODE_ENV: 'production' })).toThrow(/production/);
  });

  it('runs in development and tests', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: 'test' })).not.toThrow();
    expect(() => assertSeedAllowed({})).not.toThrow();
  });
});
