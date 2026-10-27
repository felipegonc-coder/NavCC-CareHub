import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { commandsFor, dependentsOf, planTests, readWorkspaces } from './ci-test-scope.mjs';

/** @typedef {import('./ci-test-scope.mjs').Workspace} Workspace */

/**
 * A made-up repository: the apps use the lane packages, team-chat and learning-player use
 * team-time, and apps/web uses team-time only through team-chat.
 * @type {Workspace[]}
 */
const WORKSPACES = [
  { dir: 'apps/server', name: '@carehub/server', dependencies: ['@carehub/learning', '@carehub/team-time'] },
  { dir: 'apps/web', name: '@carehub/web', dependencies: ['@carehub/learning', '@carehub/team-chat'] },
  { dir: 'packages/learning', name: '@carehub/learning', dependencies: ['zod'] },
  { dir: 'packages/team-time', name: '@carehub/team-time', dependencies: [] },
  { dir: 'packages/team-chat', name: '@carehub/team-chat', dependencies: ['@carehub/team-time'] },
  { dir: 'packages/learning-player', name: '@carehub/learning-player', dependencies: ['@carehub/team-time'] },
  { dir: 'tests/e2e', name: '@carehub/e2e', dependencies: [] },
];

const SERVER_CORE = ['src/app.test.ts', 'src/core/', 'src/features/auth/'];
const WEB_CORE = ['src/routes.test.tsx', 'src/slots.test.ts'];
const TEAM_SERVER = [
  'messages',
  'notices',
  'live',
  'push',
  'jobs',
  'reminders',
  'home',
  'calendar',
  'meetings',
  'automations',
  'analytics',
  'status',
].map((name) => `src/features/${name}/`);

test('a change outside the lane folders runs every test', () => {
  assert.deepEqual(
    planTests(['apps/web/src/features/learning/Player.tsx', 'apps/web/src/routes.tsx'], WORKSPACES),
    { all: true, reason: 'apps/web/src/routes.tsx' },
  );
  assert.deepEqual(commandsFor({ all: true, reason: 'x' }), [['npm', 'run', 'test']]);
});

test('lane feature folders run only their own tests, plus the core wiring tests', () => {
  const plan = planTests(
    [
      'apps/server/src/features/learning/routes.ts',
      'apps/server/src/features/learning/routes.test.ts',
      'apps/web/src/features/learning/Player.tsx',
      'docs/learning/notes.md',
      '',
    ],
    WORKSPACES,
  );
  assert.deepEqual(plan, {
    all: false,
    runs: [
      { workspace: 'apps/server', filters: ['src/features/learning/', ...SERVER_CORE] },
      { workspace: 'apps/web', filters: ['src/features/learning/', ...WEB_CORE] },
    ],
  });
  assert.deepEqual(commandsFor(plan), [
    ['npm', 'run', 'test', '-w', 'apps/server', '--if-present', '--', '--passWithNoTests', 'src/features/learning/', ...SERVER_CORE],
    ['npm', 'run', 'test', '-w', 'apps/web', '--if-present', '--', '--passWithNoTests', 'src/features/learning/', ...WEB_CORE],
  ]);
});

test("a lane package also runs the lane's feature folders and every workspace that uses it", () => {
  assert.deepEqual(dependentsOf('packages/team-time', WORKSPACES), [
    'apps/server',
    'packages/team-chat',
    'packages/learning-player',
    'apps/web',
  ]);
  const plan = planTests(['packages/team-time/src/a.ts'], WORKSPACES);
  assert.equal(plan.all, false);
  const runs = Object.fromEntries((plan.all ? [] : plan.runs).map((run) => [run.workspace, run.filters]));
  assert.deepEqual(Object.keys(runs).sort(), [
    'apps/server',
    'apps/web',
    'packages/learning-player',
    'packages/team-chat',
    'packages/team-time',
  ]);
  assert.equal(runs['packages/team-time'], null);
  assert.equal(runs['packages/team-chat'], null);
  assert.equal(runs['packages/learning-player'], null);
  // Team's folders in both apps (web also notifications), Learning's because learning-player
  // uses team-time, and the core tests.
  assert.deepEqual(runs['apps/server'], [...TEAM_SERVER, 'src/features/learning/', ...SERVER_CORE]);
  assert.deepEqual(runs['apps/web'], [
    ...TEAM_SERVER,
    'src/features/notifications/',
    'src/features/learning/',
    ...WEB_CORE,
  ]);
});

test('two lanes in one pull request run both; notifications is Team only in the web app', () => {
  const plan = planTests(
    [
      'apps/server/src/features/forms/fill.ts',
      'apps/server/src/features/notices/send.ts',
      'apps/web/src/features/notifications/Bell.tsx',
      'tests/e2e/extras/search.spec.ts',
    ],
    WORKSPACES,
  );
  assert.deepEqual(plan, {
    all: false,
    runs: [
      { workspace: 'apps/server', filters: ['src/features/forms/', 'src/features/notices/', ...SERVER_CORE] },
      { workspace: 'apps/web', filters: ['src/features/notifications/', ...WEB_CORE] },
      { workspace: 'tests/e2e', filters: null },
    ],
  });
  assert.equal(planTests(['apps/server/src/features/notifications/a.ts'], WORKSPACES).all, true);
});

test('migrations, package.json files, lane registration files and look-alike folders run every test', () => {
  for (const file of [
    'apps/server/migrations/202610270700_learning_progress.sql',
    'packages/learning/package.json',
    'package-lock.json',
    'packages/editor/src/lanes/learning.ts',
    'apps/server/src/features/learning-admin/a.ts',
    'apps/server/src/features/pages/tree.ts',
    'scripts/ci-test-scope.mjs',
  ]) {
    assert.equal(planTests([file], WORKSPACES).all, true, file);
  }
});

test('only docs and Markdown means no unit tests', () => {
  assert.deepEqual(planTests(['docs/decisions/0400-extras.md', 'packages/learning/README.md'], WORKSPACES), {
    all: false,
    runs: [],
  });
  assert.deepEqual(commandsFor({ all: false, runs: [] }), []);
});

test('reads the real workspaces, with their package names', () => {
  const workspaces = readWorkspaces(fileURLToPath(new URL('..', import.meta.url)));
  const server = workspaces.find((workspace) => workspace.dir === 'apps/server');
  assert.equal(server?.name, '@carehub/server');
  assert.ok(server?.dependencies.includes('@carehub/shared'));
});
