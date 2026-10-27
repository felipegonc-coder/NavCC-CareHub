import { randomBytes } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db';
import { verifyPassword } from './features/auth/passwords';
import { users } from './features/auth/schema';
import { roles, workspaceMembers, workspaces } from './features/workspaces';
import { SEED_PEOPLE, SeedRefusal, runSeed, seedSettingsFrom, type SeedContext } from './seed';
import { createTestApp, createUser, hasDatabase, type TestApp } from './testing';

// Made up for each run, like CAREHUB_SEED_PASSWORD in CI.
const password = randomBytes(18).toString('base64url');
const noFeatures = async () => undefined;

/** Everyone, with their workspace role, so two runs can be compared. */
async function everyone(db: Db) {
  return db
    .select({
      email: users.email,
      name: users.name,
      isSiteAdmin: users.isSiteAdmin,
      passwordHash: users.passwordHash,
      role: roles.name,
      kind: workspaceMembers.kind,
      removedAt: workspaceMembers.removedAt,
    })
    .from(users)
    .leftJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
    .leftJoin(roles, eq(roles.id, workspaceMembers.roleId))
    .orderBy(asc(users.email));
}

describe('seed settings', () => {
  it('needs CAREHUB_SEED_PASSWORD, which has no default, of at least 12 characters', () => {
    expect(() => seedSettingsFrom({})).toThrow(SeedRefusal);
    expect(() => seedSettingsFrom({})).toThrow(/Set CAREHUB_SEED_PASSWORD/);
    expect(() => seedSettingsFrom({ CAREHUB_SEED_PASSWORD: '' })).toThrow(/no default/);
    expect(() => seedSettingsFrom({ CAREHUB_SEED_PASSWORD: 'x'.repeat(11) })).toThrow(/12/);
    expect(seedSettingsFrom({ CAREHUB_SEED_PASSWORD: password })).toEqual({ password });
  });

  it('never runs with NODE_ENV=production', () => {
    expect(() =>
      seedSettingsFrom({ NODE_ENV: 'production', CAREHUB_SEED_PASSWORD: password }),
    ).toThrow(/NODE_ENV=production/);
  });
});

describe.skipIf(!hasDatabase)('runSeed', () => {
  let test: TestApp;
  let ctx: SeedContext;

  beforeAll(async () => {
    test = await createTestApp();
    ctx = await runSeed(test.db, { password, log: test.app.log, features: noFeatures });
  });

  afterAll(async () => {
    await test?.close();
  });

  it('adds the workspace and the people, each with their role and site admin flag', async () => {
    const [workspace] = await test.db
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces);
    expect(workspace).toEqual({ id: ctx.workspaceId, name: 'Care Hub' });
    const people = await everyone(test.db);
    expect(
      people.map(({ email, name, isSiteAdmin, role, kind }) => ({
        email,
        name,
        isSiteAdmin,
        role,
        kind,
      })),
    ).toEqual([
      {
        email: 'avery.admin@example.test',
        name: 'Avery Admin',
        isSiteAdmin: true,
        role: 'Admin',
        kind: 'member',
      },
      {
        email: 'casey.commenter@example.test',
        name: 'Casey Commenter',
        isSiteAdmin: false,
        role: 'Commenter',
        kind: 'member',
      },
      {
        email: 'eli.editor@example.test',
        name: 'Eli Editor',
        isSiteAdmin: false,
        role: 'Editor',
        kind: 'member',
      },
      {
        email: 'jordan.siteadmin@example.test',
        name: 'Jordan Siteadmin',
        isSiteAdmin: true,
        role: null,
        kind: null,
      },
      {
        email: 'morgan.admin@example.test',
        name: 'Morgan Admin',
        isSiteAdmin: false,
        role: 'Admin',
        kind: 'member',
      },
      {
        email: 'val.viewer@example.test',
        name: 'Val Viewer',
        isSiteAdmin: false,
        role: 'Viewer',
        kind: 'member',
      },
    ]);
    expect(people).toHaveLength(SEED_PEOPLE.length);
    expect(Object.values(ctx.users).map((user) => user.email)).toEqual([
      'avery.admin@example.test',
      'eli.editor@example.test',
      'casey.commenter@example.test',
      'val.viewer@example.test',
    ]);
    expect(ctx.teamSpaceId).toBeNull();
  });

  it('gives everyone the seed password', async () => {
    for (const { email, passwordHash } of await everyone(test.db)) {
      expect(passwordHash, email).toMatch(/^\$argon2id\$/);
      expect(await verifyPassword(passwordHash ?? '', password), email).toBe(true);
    }
  });

  it('changes nothing when it runs again', async () => {
    const before = await everyone(test.db);
    const again = await runSeed(test.db, { password, log: test.app.log, features: noFeatures });
    expect(await everyone(test.db)).toEqual(before);
    expect(again.users).toEqual(ctx.users);
  });

  it('gives features createRole and createPerson, both safe to call twice', async () => {
    const role = { name: 'Fictional reviewer', permissions: ['pages.comment'] as const };
    const first = await ctx.createRole(role);
    expect(await ctx.createRole({ ...role, name: 'FICTIONAL REVIEWER' })).toEqual({ id: first.id });
    const who = {
      key: 'reviewer',
      name: 'Rio Reviewer',
      email: 'Rio.Reviewer@example.test',
      roleId: first.id,
    };
    const person = await ctx.createPerson(who);
    expect(person).toMatchObject({ name: 'Rio Reviewer', email: 'rio.reviewer@example.test' });
    expect(await ctx.createPerson(who)).toEqual(person);
    const [member] = await test.db
      .select({ roleId: workspaceMembers.roleId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, person.id));
    expect(member).toEqual({ roleId: first.id });
    await expect(ctx.createPerson({ ...who, email: 'rio@company.example' })).rejects.toThrow(
      /example\.test/,
    );
  });

  it("runs every feature's seed, twice", async () => {
    await runSeed(test.db, { password, log: test.app.log });
    await runSeed(test.db, { password, log: test.app.log });
  }, 60_000);
});

describe.skipIf(!hasDatabase)('runSeed on a database that is in use', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await createTestApp();
  });

  afterAll(async () => {
    await test?.close();
  });

  it('refuses when there are accounts outside example.test, and changes nothing', async () => {
    await createUser(test.db, { email: 'pat.lee@company.example' });
    const before = await everyone(test.db);
    await expect(
      runSeed(test.db, { password, log: test.app.log, features: noFeatures }),
    ).rejects.toThrow(SeedRefusal);
    expect(await everyone(test.db)).toEqual(before);
  });
});
