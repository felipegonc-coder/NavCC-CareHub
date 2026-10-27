import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, hasDatabase, type TestApp } from '../../testing';
import { DEFAULT_PREFERENCES } from './domain/preferences';
import { createTestSubscription } from './protocol/testing';
import { pushPreferences, pushSubscriptions } from './schema';
import { createPostgresPushStore } from './store';
import { createMemoryPushStore } from './testing';
import { MAX_SUBSCRIPTIONS_PER_PERSON, type NewPushSubscription, type PushStore } from './types';

interface Opened {
  store: PushStore;
  avery: string;
  sam: string;
}

const t = (minute: number) => new Date(Date.UTC(2026, 9, 27, 15, minute));

/** The same checks for the Postgres store and the memory store. */
function describeStore(name: string, open: () => Promise<Opened>) {
  describe(name, () => {
    // Endpoints are unique across people, so each test gets its own.
    const run = randomUUID();
    const endpoint = (browser: string) => `https://fcm.googleapis.com/fcm/send/${run}-${browser}`;
    let tests = 0;
    async function setup() {
      const opened = await open();
      const prefix = `t${(tests += 1)}`;
      const at = (browser: string) => endpoint(`${prefix}-${browser}`);
      const subscription = (userId: string, browser: string): NewPushSubscription => ({
        userId,
        endpoint: at(browser),
        keys: createTestSubscription().keys,
        device: 'Chrome on Windows',
        expiresAt: null,
      });
      const endpoints = async (userId: string) =>
        (await opened.store.listSubscriptions(userId)).map((saved) => saved.endpoint);
      return { ...opened, at, subscription, endpoints };
    }

    it('saves each browser once and refreshes it when it comes again', async () => {
      const { store, avery, at, subscription } = await setup();
      const first = await store.saveSubscription(subscription(avery, 'laptop'), t(0));
      expect(first).toMatchObject({
        userId: avery,
        endpoint: at('laptop'),
        device: 'Chrome on Windows',
        expiresAt: null,
        createdAt: t(0),
        lastUsedAt: t(0),
      });
      const keys = createTestSubscription().keys;
      const again = await store.saveSubscription(
        { ...subscription(avery, 'laptop'), keys, device: 'Edge on Windows', expiresAt: t(50) },
        t(5),
      );
      expect(again).toEqual({
        ...first,
        keys,
        device: 'Edge on Windows',
        expiresAt: t(50),
        lastUsedAt: t(5),
      });
      expect(await store.listSubscriptions(avery)).toEqual([again]);
    });

    it('lists a person’s browsers in the order they were added', async () => {
      const { store, avery, sam, at, subscription, endpoints } = await setup();
      await store.saveSubscription(subscription(avery, 'phone'), t(1));
      await store.saveSubscription(subscription(sam, 'tablet'), t(2));
      await store.saveSubscription(subscription(avery, 'laptop'), t(3));
      expect(await endpoints(avery)).toEqual([at('phone'), at('laptop')]);
      expect(await endpoints(sam)).toEqual([at('tablet')]);
    });

    it('gives a browser to whoever saved it last', async () => {
      const { store, avery, sam, at, subscription, endpoints } = await setup();
      await store.saveSubscription(subscription(avery, 'shared'), t(0));
      const moved = await store.saveSubscription(subscription(sam, 'shared'), t(1));
      expect(moved).toMatchObject({ userId: sam, createdAt: t(1) });
      expect(await endpoints(avery)).toEqual([]);
      expect(await endpoints(sam)).toEqual([at('shared')]);
    });

    it('deletes the endpoint a new one replaces, if it was the same person’s', async () => {
      const { store, avery, sam, at, subscription, endpoints } = await setup();
      await store.saveSubscription(subscription(avery, 'old'), t(0));
      await store.saveSubscription(subscription(sam, 'sams'), t(0));
      await store.saveSubscription({ ...subscription(avery, 'new'), replaces: at('old') }, t(1));
      await store.saveSubscription({ ...subscription(avery, 'newer'), replaces: at('sams') }, t(2));
      expect(await endpoints(avery)).toEqual([at('new'), at('newer')]);
      expect(await endpoints(sam)).toEqual([at('sams')]);
    });

    it(`keeps the ${MAX_SUBSCRIPTIONS_PER_PERSON} browsers used most recently`, async () => {
      const { store, avery, at, subscription, endpoints } = await setup();
      for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_PERSON + 1; i += 1) {
        await store.saveSubscription(subscription(avery, `browser-${i}`), t(i));
      }
      expect(await endpoints(avery)).toHaveLength(MAX_SUBSCRIPTIONS_PER_PERSON);
      expect(await endpoints(avery)).not.toContain(at('browser-0'));
      // Sent again, browser-1 is the newest, so browser-2 goes next.
      await store.saveSubscription(subscription(avery, 'browser-1'), t(40));
      await store.saveSubscription(subscription(avery, 'one-more'), t(41));
      const kept = await endpoints(avery);
      expect(kept).toHaveLength(MAX_SUBSCRIPTIONS_PER_PERSON);
      expect(kept).toContain(at('browser-1'));
      expect(kept).not.toContain(at('browser-2'));
    });

    it('deletes by endpoint or id, and only the person’s own', async () => {
      const { store, avery, sam, subscription } = await setup();
      const laptop = await store.saveSubscription(subscription(avery, 'laptop'), t(0));
      const phone = await store.saveSubscription(subscription(avery, 'phone'), t(0));
      expect(await store.deleteSubscription(sam, { id: laptop.id })).toBe(false);
      expect(await store.deleteSubscription(sam, { endpoint: phone.endpoint })).toBe(false);
      expect(await store.deleteSubscription(avery, { id: laptop.id })).toBe(true);
      expect(await store.deleteSubscription(avery, { endpoint: phone.endpoint })).toBe(true);
      expect(await store.deleteSubscription(avery, { endpoint: phone.endpoint })).toBe(false);
      expect(await store.listSubscriptions(avery)).toEqual([]);
    });

    it('forgets endpoints a push service gave up on, and marks others used', async () => {
      const { store, avery, sam, subscription } = await setup();
      const laptop = await store.saveSubscription(subscription(avery, 'laptop'), t(0));
      const phone = await store.saveSubscription(subscription(avery, 'phone'), t(0));
      const tablet = await store.saveSubscription(subscription(sam, 'tablet'), t(0));
      await store.markUsed([laptop.id], t(7));
      await store.markUsed([], t(8));
      await store.forgetEndpoints([phone.endpoint, tablet.endpoint]);
      await store.forgetEndpoints([]);
      expect(await store.listSubscriptions(avery)).toEqual([{ ...laptop, lastUsedAt: t(7) }]);
      expect(await store.listSubscriptions(sam)).toEqual([]);
    });

    it('keeps notification settings per person, starting from the defaults', async () => {
      const { store, avery, sam } = await setup();
      expect(await store.getPreferences(avery)).toEqual(DEFAULT_PREFERENCES);
      expect(await store.updatePreferences(avery, { showText: false }, t(1))).toEqual({
        notifyAbout: 'all',
        showText: false,
      });
      await store.updatePreferences(avery, { notifyAbout: 'mentions' }, t(2));
      expect(await store.getPreferences(avery)).toEqual({
        notifyAbout: 'mentions',
        showText: false,
      });
      expect(await store.getPreferences(sam)).toEqual(DEFAULT_PREFERENCES);
    });
  });
}

describeStore('memory push store', async () => ({
  store: createMemoryPushStore(),
  avery: randomUUID(),
  sam: randomUUID(),
}));

describe.skipIf(!hasDatabase)('Postgres push store', () => {
  let testApp: TestApp;
  beforeAll(async () => {
    testApp = await createTestApp();
  });
  afterAll(async () => {
    await testApp?.close();
  });

  describeStore('contract', async () => {
    const avery = await createUser(testApp.db, { name: 'Avery Lin' });
    const sam = await createUser(testApp.db, { name: 'Sam Ortiz' });
    return { store: createPostgresPushStore(testApp.db), avery: avery.id, sam: sam.id };
  });

  it('creates the tables exactly as the Drizzle definitions describe them', async () => {
    for (const table of [pushSubscriptions, pushPreferences]) {
      const config = getTableConfig(table);
      const { rows } = await testApp.db.execute<{
        name: string;
        type: string;
        not_null: boolean;
        has_default: boolean;
      }>(sql`
        SELECT attname AS name, format_type(atttypid, atttypmod) AS type,
               attnotnull AS not_null, atthasdef AS has_default
        FROM pg_attribute
        WHERE attrelid = ${config.name}::regclass AND attnum > 0 AND NOT attisdropped`);
      const inDatabase = Object.fromEntries(
        rows.map((row) => [
          row.name,
          { type: row.type, notNull: row.not_null, hasDefault: row.has_default },
        ]),
      );
      const inDrizzle = Object.fromEntries(
        config.columns.map((column) => [
          column.name,
          { type: column.getSQLType(), notNull: column.notNull, hasDefault: column.hasDefault },
        ]),
      );
      expect(inDatabase, config.name).toEqual(inDrizzle);
    }
  });

  it('refuses endpoints that are not https', async () => {
    const riley = await createUser(testApp.db, { name: 'Riley Chen' });
    const store = createPostgresPushStore(testApp.db);
    const subscription = {
      userId: riley.id,
      endpoint: `http://fcm.googleapis.com/fcm/send/${randomUUID()}`,
      keys: createTestSubscription().keys,
      device: 'Chrome on Windows',
      expiresAt: null,
    };
    await expect(store.saveSubscription(subscription, t(0))).rejects.toThrow();
  });

  it('deletes a person’s browsers and settings with the person', async () => {
    const jordan = await createUser(testApp.db, { name: 'Jordan Patel' });
    const store = createPostgresPushStore(testApp.db);
    await store.saveSubscription(
      {
        userId: jordan.id,
        endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
        keys: createTestSubscription().keys,
        device: 'Firefox on Mac',
        expiresAt: null,
      },
      t(0),
    );
    await store.updatePreferences(jordan.id, { showText: false }, t(0));
    await testApp.db.execute(sql`DELETE FROM users WHERE id = ${jordan.id}`);
    expect(await store.listSubscriptions(jordan.id)).toEqual([]);
    expect(await store.getPreferences(jordan.id)).toEqual(DEFAULT_PREFERENCES);
  });
});
