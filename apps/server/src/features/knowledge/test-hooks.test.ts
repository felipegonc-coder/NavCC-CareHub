import {
  KB_PROPERTY,
  KB_STATUS_OPTION,
  addDays,
  addMonths,
  todayIn,
  type KbPageInfo,
} from '@carehub/extras/knowledge';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { users } from '../auth/schema';
import { createFakeKnowledge } from './fakes';
import { testHooksOn } from './test-hooks';

const quiet = { warn: () => {} };
const TIME_ZONE = 'Pacific/Auckland';

describe('the knowledge base test hook switch', () => {
  it('is on only with CAREHUB_TEST_HOOKS=1', () => {
    expect(testHooksOn({ env: { CAREHUB_TEST_HOOKS: '1' }, log: quiet })).toBe(true);
    for (const value of [undefined, '', '0', 'true', 'yes', ' 1']) {
      expect(testHooksOn({ env: { CAREHUB_TEST_HOOKS: value }, log: quiet })).toBe(false);
    }
  });
});

describe.skipIf(!hasDatabase)('verify until a date with the test hook on', () => {
  const fake = createFakeKnowledge();
  let test: TestApp;
  /** Can edit, and owns the page. */
  let jordan: TestUser;
  /** Can view. */
  let casey: TestUser;
  let unbind: (() => void) | undefined;

  beforeAll(async () => {
    const before = process.env.CAREHUB_TEST_HOOKS;
    process.env.CAREHUB_TEST_HOOKS = '1';
    try {
      test = await createTestApp();
    } finally {
      if (before === undefined) delete process.env.CAREHUB_TEST_HOOKS;
      else process.env.CAREHUB_TEST_HOOKS = before;
    }
    jordan = await createUser(test.db, { name: 'Jordan Park', email: 'jordan.park@example.test' });
    casey = await createUser(test.db, { name: 'Casey Wu', email: 'casey.wu@example.test' });
    await test.db.update(users).set({ timeZone: TIME_ZONE }).where(eq(users.id, jordan.id));
    unbind = fake.bind();
  });
  afterAll(async () => {
    unbind?.();
    await test?.close();
  });

  const newPage = () => {
    const kb = fake.newBase([
      [jordan.id, 'edit'],
      [casey.id, 'view'],
    ]);
    return fake.addPage(kb, jordan.id, { [KB_PROPERTY.status]: KB_STATUS_OPTION.published });
  };
  const verifyUntil = (user: TestUser, pageId: string, until: string) =>
    injectAs(test.app, user, {
      method: 'POST',
      url: `/api/knowledge/pages/${pageId}/verification`,
      payload: { period: 'date', until },
    });

  it('takes today and earlier days, so the page can turn Expired at once', async () => {
    const pageId = newPage();
    const today = todayIn(TIME_ZONE, new Date());
    for (const until of [addDays(today, -1), today, '2020-01-01']) {
      const response = await verifyUntil(jordan, pageId, until);
      expect(response.statusCode).toBe(200);
      expect((response.json() as KbPageInfo).verification).toMatchObject({
        state: 'verified',
        verifiedBy: { id: jordan.id, name: 'Jordan Park' },
        until,
      });
    }
  });

  it('still checks the ten-year limit, the date and who may verify', async () => {
    const pageId = newPage();
    const today = todayIn(TIME_ZONE, new Date());
    const tooFar = await verifyUntil(jordan, pageId, addMonths(today, 132));
    expect(tooFar.statusCode).toBe(400);
    expect(tooFar.json()).toMatchObject({
      error: { code: 'invalid', message: 'Pick a date after today, up to ten years ahead.' },
    });
    expect((await verifyUntil(jordan, pageId, '2026-02-30')).statusCode).toBe(400);
    expect((await verifyUntil(casey, pageId, addDays(today, -1))).statusCode).toBe(403);
  });
});
