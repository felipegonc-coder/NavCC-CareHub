import { randomUUID } from 'node:crypto';
import type { HistoryDoc } from '@carehub/extras/history';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDatabase, type TestApp } from '../../testing';
import {
  bindRetentionSetting,
  countExpiringVersions,
  deleteExpiredVersions,
  hourStart,
  isCleanupHour,
  nextCleanupAt,
  versionRetentionDays,
  versionStorageBytes,
} from './retention';
import { historyVersions } from './schema';

const DAY = 24 * 60 * 60 * 1000;

describe('the night of the clean-up', () => {
  it('is the 3 AM hour in Denver, summer and winter time', () => {
    expect(isCleanupHour(new Date('2026-10-27T09:30:00Z'))).toBe(true);
    expect(isCleanupHour(new Date('2026-10-27T10:30:00Z'))).toBe(false);
    expect(isCleanupHour(new Date('2026-12-01T10:05:00Z'))).toBe(true);
  });

  it('counts ages from 3:00 sharp', () => {
    expect(hourStart(new Date('2026-10-27T09:47:12.345Z')).toISOString()).toBe(
      '2026-10-27T09:00:00.000Z',
    );
  });

  it('knows when the next clean-up is, across the clock changes', () => {
    const next = (now: string) => nextCleanupAt(new Date(now)).toISOString();
    expect(next('2026-10-27T14:00:00Z')).toBe('2026-10-28T09:00:00.000Z');
    expect(next('2026-10-28T09:10:00Z')).toBe('2026-10-29T09:00:00.000Z');
    expect(next('2026-10-31T12:00:00Z')).toBe('2026-11-01T10:00:00.000Z');
    expect(next('2026-03-07T20:00:00Z')).toBe('2026-03-08T09:00:00.000Z');
  });
});

describe('how long versions are kept, until workspace settings are bound', () => {
  it('keeps them a year', async () => {
    const db = {} as Parameters<typeof versionRetentionDays>[0];
    expect(await versionRetentionDays(db, randomUUID())).toBe(365);
  });
});

describe.skipIf(!hasDatabase)('the clean-up on Postgres', () => {
  let test: TestApp;
  const unbind: (() => void)[] = [];
  const workspaceId = randomUUID();
  let days: unknown;

  beforeAll(async () => {
    test = await createTestApp();
    unbind.push(bindRetentionSetting(async (_db, id) => (id === workspaceId ? days : undefined)));
  });
  afterAll(async () => {
    for (const off of unbind) off();
    await test?.close();
  });

  const paragraph = (text: string): HistoryDoc => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

  it('HT-03 and DS-01: the night after the period is shortened, exactly the counted versions go and named ones stay', async () => {
    const night = nextCleanupAt();
    const pageId = randomUUID();
    const row = (name: string | null, age: number) => ({
      pageId,
      workspaceId,
      kind: 'automatic' as const,
      name,
      content: paragraph('Fictional visit notes.'),
      digest: `age-${age}-${name}`,
      size: 100,
      createdAt: new Date(night.getTime() - age * DAY),
    });
    await test.db
      .insert(historyVersions)
      .values([
        row(null, 40),
        row(null, 31),
        row('Before the Nov policy change', 40),
        row(null, 10),
      ]);
    expect(await versionStorageBytes(test.db, workspaceId)).toBe(400);

    days = null;
    expect(await deleteExpiredVersions(test.db, night)).not.toContainEqual(
      expect.objectContaining({ workspaceId }),
    );

    days = 30;
    const counted = await countExpiringVersions(test.db, workspaceId, 30, night);
    expect(counted).toBe(2);
    expect(await deleteExpiredVersions(test.db, night)).toContainEqual({
      workspaceId,
      deleted: counted,
    });
    const left = await test.db
      .select({ name: historyVersions.name })
      .from(historyVersions)
      .where(eq(historyVersions.workspaceId, workspaceId));
    expect(left.map((one) => one.name).sort()).toEqual(['Before the Nov policy change', null]);
    expect(await versionStorageBytes(test.db, workspaceId)).toBe(200);

    // A setting that isn't one of the choices counts as the default, a year.
    days = 12;
    expect(await versionRetentionDays(test.db, workspaceId)).toBe(365);
    expect(await deleteExpiredVersions(test.db, night)).not.toContainEqual(
      expect.objectContaining({ workspaceId }),
    );
  });
});
