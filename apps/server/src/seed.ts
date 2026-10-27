import type { FastifyBaseLogger } from 'fastify';

// Stand-ins until the database and accounts PRs land; each replaces its own line.
type Db = unknown; // database: `import type { Db } from './db';`

type PermissionKey = string; // accounts: `import type { PermissionKey } from '@carehub/shared';`

type User = { id: string; email: string; name: string }; // accounts: its `User` type

/** What each feature's `seed(ctx)` gets (decision 0007, section 2.5). */
export interface SeedContext {
  db: Db;
  workspaceId: string;
  users: { admin: User; editor: User; commenter: User; viewer: User };
  teamSpaceId: string;
  log: FastifyBaseLogger;
  /** Adds a custom role, such as Learning's "Trainer". */
  createRole(role: {
    name: string;
    permissions: readonly PermissionKey[];
  }): Promise<{ id: string }>;
  /** Adds a person with a role; `key` is a short stable name for them, such as 'trainer'. */
  createPerson(person: { key: string; name: string; email: string; roleId: string }): Promise<User>;
}

/**
 * Runs every feature's seed after the core seed, which builds `ctx` (the accounts PR adds it and
 * the `seed` CLI command). Seeds load fictional data only and must be safe to run twice.
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

  await (await import('./features/status/seed')).seed(ctx);

  await (await import('./features/claude/seed')).seed(ctx);
}
