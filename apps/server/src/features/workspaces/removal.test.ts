import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, hasDatabase, injectAs, type TestApp } from '../../testing';
import { sessions } from '../auth/schema';
import { createSession } from '../auth/sessions';
import { liveHub } from '../live';
import { createPostgresPushStore } from '../push';
import { addMember, getCurrentMember } from './members';
import { removeMember } from './removal';

describe.skipIf(!hasDatabase)('removing someone from the workspace', () => {
  let testApp: TestApp;
  let app: FastifyInstance;

  beforeAll(async () => {
    testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await testApp?.close();
  });

  const sessionIds = async (userId: string) =>
    (
      await testApp.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId))
    ).map((row) => row.id);

  it('ends all their sessions, then sends session.ended and member.removed', async () => {
    const person = await createUser(testApp.db, { role: 'editor' });
    const other = await createUser(testApp.db);
    const first = await createSession(testApp.db, person.id);
    const second = await createSession(testApp.db, person.id);
    const theirs = await createSession(testApp.db, other.id);
    const heard: [string, object][] = [];
    const stop = [
      app.events.on('session.ended', (event) => void heard.push(['session.ended', event])),
      app.events.on('member.removed', (event) => void heard.push(['member.removed', event])),
    ];
    try {
      expect(await removeMember(app, person.id)).toBe(true);
      await app.events.settled();
    } finally {
      for (const off of stop) off();
    }

    expect(await getCurrentMember(testApp.db, person.id)).toBeNull();
    expect(await sessionIds(person.id)).toEqual([]);
    expect(await sessionIds(other.id)).toContain(theirs.id);
    expect(heard).toHaveLength(3);
    expect(heard.slice(0, 2)).toEqual(
      expect.arrayContaining([
        ['session.ended', { sessionId: first.id, userId: person.id }],
        ['session.ended', { sessionId: second.id, userId: person.id }],
      ]),
    );
    expect(heard[2]).toEqual([
      'member.removed',
      { workspaceId: person.workspaceId, userId: person.id },
    ]);

    const cookie = `${app.sessionCookies.names.session}=${first.token}`;
    const old = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(old.statusCode).toBe(401);
    // They can still sign in, now outside the workspace.
    const me = await injectAs(app, person, { method: 'GET', url: '/api/auth/me' });
    expect(me.json()).toMatchObject({ member: null });
  });

  it('closes their open live streams and deletes their push browsers, nobody else’s', async () => {
    const person = await createUser(testApp.db);
    const other = await createUser(testApp.db);
    const ended = { person: 0, other: 0 };
    const sink = (who: keyof typeof ended) => ({
      write: () => true,
      end: () => void (ended[who] += 1),
    });
    liveHub.connect(person.id, sink('person'));
    liveHub.connect(person.id, sink('person'));
    const kept = liveHub.connect(other.id, sink('other'));
    const push = createPostgresPushStore(testApp.db);
    const browser = (userId: string) =>
      push.saveSubscription(
        {
          userId,
          endpoint: `https://fcm.googleapis.com/fcm/send/fictional-${randomBytes(6).toString('hex')}`,
          keys: {
            p256dh: randomBytes(65).toString('base64url'),
            auth: randomBytes(16).toString('base64url'),
          },
          device: 'Firefox on Linux',
          expiresAt: null,
        },
        new Date(),
      );
    await browser(person.id);
    await browser(person.id);
    await browser(other.id);
    try {
      expect(await removeMember(app, person.id)).toBe(true);
      await app.events.settled();
      expect(ended).toEqual({ person: 2, other: 0 });
      expect(liveHub.hasOpenTabs(person.id)).toBe(false);
      expect(liveHub.hasOpenTabs(other.id)).toBe(true);
      expect(await push.listSubscriptions(person.id)).toEqual([]);
      expect(await push.listSubscriptions(other.id)).toHaveLength(1);
    } finally {
      kept.disconnect();
    }
  });

  it('removes guests too, answers false when there is nobody to remove, and addMember undoes it', async () => {
    const guest = await createUser(testApp.db, { kind: 'guest' });
    const outsider = await createUser(testApp.db, { role: null });
    const heard: object[] = [];
    const off = app.events.on('member.removed', (event) => void heard.push(event));
    try {
      expect(await removeMember(app, guest.id)).toBe(true);
      expect(await removeMember(app, guest.id)).toBe(false);
      expect(await removeMember(app, outsider.id)).toBe(false);
      await app.events.settled();
    } finally {
      off();
    }
    expect(heard).toEqual([{ workspaceId: guest.workspaceId, userId: guest.id }]);
    expect(await getCurrentMember(testApp.db, guest.id)).toBeNull();

    await addMember(testApp.db, { userId: guest.id, role: 'commenter' });
    expect(await getCurrentMember(testApp.db, guest.id)).toMatchObject({
      kind: 'member',
      roleName: 'Commenter',
    });
    const back = await injectAs(app, guest, { method: 'GET', url: '/api/reminders' });
    expect(back.statusCode).toBe(200);
  });
});
