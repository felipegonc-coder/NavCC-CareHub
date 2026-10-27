import { describe, expect, it } from 'vitest';
import { meResponseSchema } from './index';

describe('meResponseSchema', () => {
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'test.person@example.test',
    name: 'Test Person',
    avatarUrl: null,
    isSiteAdmin: false,
    timeZone: 'America/Denver',
    use24h: false,
    weekStart: 0,
    mustChangePassword: false,
  };

  it('describes GET /api/auth/me', () => {
    const me = { user, member: null, workspace: null };
    expect(meResponseSchema.parse(me)).toEqual(me);
  });

  it('rejects a week that starts on an unknown day', () => {
    const me = { user: { ...user, weekStart: 7 }, member: null, workspace: null };
    expect(meResponseSchema.safeParse(me).success).toBe(false);
  });
});
