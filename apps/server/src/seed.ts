import type { BuiltInRoleKey, PermissionKey } from '@carehub/shared';
import { and, eq, notLike, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from './db';
import {
  createAccount,
  findAccountByEmail,
  normalizeEmail,
  type Account,
} from './features/auth/accounts';
import { users } from './features/auth/schema';
import { createRole } from './features/roles';
import { addMember, roles, syncDefaultWorkspace } from './features/workspaces';

/** What each feature's `seed(ctx)` gets (decision 0007, section 2.5). */
export interface SeedContext {
  db: Db;
  workspaceId: string;
  users: { admin: Account; editor: Account; commenter: Account; viewer: Account };
  /** The team space "General"; null until the page model adds it to the seed. */
  teamSpaceId: string | null;
  log: FastifyBaseLogger;
  /** Adds a custom role, such as Learning's "Trainer", or returns the one with that name. */
  createRole(role: {
    name: string;
    permissions: readonly PermissionKey[];
  }): Promise<{ id: string }>;
  /**
   * Adds a person with a role and the seed password; `key` is a short stable name for them, such as
   * 'trainer'. An existing person with that email keeps their account and gets that role.
   */
  createPerson(person: {
    key: string;
    name: string;
    email: string;
    roleId: string;
  }): Promise<Account>;
}

interface SeedPerson {
  key: string;
  name: string;
  email: string;
  /** Their role in the workspace, or null for someone outside it. */
  role: BuiltInRoleKey | null;
  siteAdmin: boolean;
}

/** The core seed's people (decision 0007, section 2.5). Their password is CAREHUB_SEED_PASSWORD. */
export const SEED_PEOPLE = [
  {
    key: 'admin',
    name: 'Avery Admin',
    email: 'avery.admin@example.test',
    role: 'admin',
    siteAdmin: true,
  },
  {
    key: 'editor',
    name: 'Eli Editor',
    email: 'eli.editor@example.test',
    role: 'editor',
    siteAdmin: false,
  },
  {
    key: 'commenter',
    name: 'Casey Commenter',
    email: 'casey.commenter@example.test',
    role: 'commenter',
    siteAdmin: false,
  },
  {
    key: 'viewer',
    name: 'Val Viewer',
    email: 'val.viewer@example.test',
    role: 'viewer',
    siteAdmin: false,
  },
  // A site admin outside the workspace, and an Admin who isn't a site admin (for example DS-12).
  {
    key: 'siteAdmin',
    name: 'Jordan Siteadmin',
    email: 'jordan.siteadmin@example.test',
    role: null,
    siteAdmin: true,
  },
  {
    key: 'workspaceAdmin',
    name: 'Morgan Admin',
    email: 'morgan.admin@example.test',
    role: 'admin',
    siteAdmin: false,
  },
] as const satisfies readonly SeedPerson[];

type SeedPersonKey = (typeof SEED_PEOPLE)[number]['key'];

/** Seeded people are fictional: every email is at example.test. */
const FICTIONAL_DOMAIN = '@example.test';

/** The seed refused (for example, a database that is in use); the message says why. */
export class SeedRefusal extends Error {
  override name = 'SeedRefusal';
}

export interface SeedSettings {
  /** Every seeded person's password. */
  password: string;
}

/**
 * The seed's settings from the environment. It never runs with NODE_ENV=production, because it adds
 * people with a known password, and CAREHUB_SEED_PASSWORD has no default.
 */
export function seedSettingsFrom(env: Record<string, string | undefined>): SeedSettings {
  if (env.NODE_ENV === 'production') {
    throw new SeedRefusal(
      'The seed adds fictional people with a known password, so it never runs with NODE_ENV=production.',
    );
  }
  const password = env.CAREHUB_SEED_PASSWORD;
  if (!password) {
    throw new SeedRefusal(
      "Set CAREHUB_SEED_PASSWORD to the seeded people's password. It has no default.",
    );
  }
  if (password.length < 12)
    throw new SeedRefusal('CAREHUB_SEED_PASSWORD needs at least 12 characters.');
  return { password };
}

export interface SeedOptions extends SeedSettings {
  log: FastifyBaseLogger;
  /** The feature seeds to run after the core seed (tests pass their own). */
  features?: (ctx: SeedContext) => Promise<void>;
}

/**
 * `node apps/server/dist/cli.js seed`: the workspace "Care Hub" and SEED_PEOPLE, then every
 * feature's seed. Only for an empty database, so it refuses one that has any account outside
 * example.test. People from an earlier run keep their accounts, so it's safe to run twice.
 */
export async function runSeed(db: Db, options: SeedOptions): Promise<SeedContext> {
  const [other] = await db
    .select({ id: users.id })
    .from(users)
    .where(notLike(users.email, `%${FICTIONAL_DOMAIN}`))
    .limit(1);
  if (other) {
    throw new SeedRefusal(
      'The seed only fills an empty database, and this one has accounts outside example.test. Nothing was changed.',
    );
  }
  const workspace = await syncDefaultWorkspace(db);
  const workspaceId = workspace.id;

  const person = async (
    who: { key: string; name: string; email: string; siteAdmin?: boolean },
    membership: { role: BuiltInRoleKey } | { roleId: string } | null,
  ): Promise<Account> => {
    const email = normalizeEmail(who.email);
    if (!email.endsWith(FICTIONAL_DOMAIN)) {
      throw new SeedRefusal(
        `Seeded people need an example.test email; ${who.key} has another one.`,
      );
    }
    const account =
      (await findAccountByEmail(db, email)) ??
      (await createAccount(db, {
        email,
        name: who.name,
        password: options.password,
        isSiteAdmin: who.siteAdmin ?? false,
      }));
    if (membership) await addMember(db, { userId: account.id, ...membership });
    return account;
  };

  const people = {} as Record<SeedPersonKey, Account>;
  for (const who of SEED_PEOPLE) {
    people[who.key] = await person(who, who.role === null ? null : { role: who.role });
  }
  options.log.info(`Seeded the workspace ${workspace.name} and ${SEED_PEOPLE.length} people`);

  const ctx: SeedContext = {
    db,
    workspaceId,
    users: {
      admin: people.admin,
      editor: people.editor,
      commenter: people.commenter,
      viewer: people.viewer,
    },
    teamSpaceId: null,
    log: options.log,
    async createRole(role) {
      const [existing] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(
          and(eq(roles.workspaceId, workspaceId), sql`lower(${roles.name}) = lower(${role.name})`),
        )
        .limit(1);
      return existing ?? (await createRole(db, { workspaceId, ...role }));
    },
    createPerson: ({ roleId, ...who }) => person(who, { roleId }),
  };
  await (options.features ?? seedFeatures)(ctx);
  return ctx;
}

/**
 * Runs every feature's seed after the core seed (`runSeed`), which builds `ctx`. Seeds load
 * fictional data only and must be safe to run twice.
 */
export async function seedFeatures(ctx: SeedContext): Promise<void> {
  ctx.log.info('Seeding feature data');

  // Each feature replaces only its own line below with
  // `await (await import('./features/<f>/seed')).seed(ctx);`,
  // so parallel pull requests never edit the same lines.

  // feature: auth

  // feature: admin

  // feature: workspaces

  // feature: pages

  // feature: collab

  // feature: comments

  // feature: mentions

  // feature: files

  await (await import('./features/search/seed')).seed(ctx);

  await (await import('./features/history/seed')).seed(ctx);

  await (await import('./features/templates/seed')).seed(ctx);

  await (await import('./features/import-export/seed')).seed(ctx);

  await (await import('./features/knowledge/seed')).seed(ctx);

  // feature: sharing

  // feature: roles

  await (await import('./features/learning/seed')).seed(ctx);

  // feature: databases

  // feature: forms

  // feature: messages

  await (await import('./features/notices/seed')).seed(ctx);

  // feature: live

  // feature: push

  // feature: jobs

  // feature: reminders

  // feature: home

  // feature: calendar

  // feature: meetings

  // feature: automations

  // feature: analytics

  // feature: status

  await (await import('./features/claude/seed')).seed(ctx);
}
