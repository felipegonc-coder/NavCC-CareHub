import { describe, expect, it, vi } from 'vitest';
import { PROFILES_PER_QUERY, profilesOf } from './store';

const { getProfiles } = vi.hoisted(() => {
  const entry = (id: string) => [id, { id, name: 'Ada Example', avatarUrl: null }] as const;
  return {
    getProfiles: vi.fn((_db: unknown, ids: Iterable<string>) =>
      Promise.resolve(new Map([...ids].map(entry))),
    ),
  };
});

vi.mock('../../auth', () => ({ getProfiles }));
vi.mock('../../workspaces', () => ({ getMembership: vi.fn() }));

const idOf = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

describe('profilesOf', () => {
  it('reads names and pictures a thousand people at a time', async () => {
    const ids = Array.from({ length: 2500 }, (_, index) => idOf(index));
    const profiles = await profilesOf({} as never, [...ids, idOf(0)]);
    expect(PROFILES_PER_QUERY).toBe(1000);
    expect(getProfiles.mock.calls.map(([, part]) => [...part].length)).toEqual([1000, 1000, 500]);
    expect([...profiles.keys()]).toEqual(ids);
    expect(profiles.get(idOf(2499))?.name).toBe('Ada Example');
  });
});
