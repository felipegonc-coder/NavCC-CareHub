import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandsFor, planTests } from './ci-test-scope.mjs';

test('a change outside the lane folders runs every test', () => {
  assert.deepEqual(planTests(['apps/web/src/features/learning/Player.tsx', 'apps/web/src/routes.tsx']), {
    all: true,
    reason: 'apps/web/src/routes.tsx',
  });
  assert.deepEqual(commandsFor({ all: true }), [['npm', 'run', 'test']]);
});

test('lane folders run only their own tests', () => {
  const plan = planTests([
    'apps/server/src/features/learning/routes.ts',
    'apps/server/src/features/learning/routes.test.ts',
    'apps/web/src/features/learning/Player.tsx',
    'packages/learning/src/index.ts',
    'docs/learning/notes.md',
    '',
  ]);
  assert.deepEqual(plan, {
    all: false,
    runs: [
      { workspace: 'apps/server', filters: ['src/features/learning/'] },
      { workspace: 'apps/web', filters: ['src/features/learning/'] },
      { workspace: 'packages/learning', filters: null },
    ],
  });
  assert.deepEqual(commandsFor(plan), [
    ['npm', 'run', 'test', '-w', 'apps/server', '--if-present', '--', '--passWithNoTests', 'src/features/learning/'],
    ['npm', 'run', 'test', '-w', 'apps/web', '--if-present', '--', '--passWithNoTests', 'src/features/learning/'],
    ['npm', 'run', 'test', '-w', 'packages/learning', '--if-present'],
  ]);
});

test('two lanes in one pull request run both', () => {
  assert.deepEqual(
    planTests([
      'apps/server/src/features/forms/fill.ts',
      'apps/server/src/features/notices/send.ts',
      'packages/team-time/src/a.ts',
      'apps/web/src/features/notifications/Bell.tsx',
      'tests/e2e/extras/search.spec.ts',
    ]),
    {
      all: false,
      runs: [
        { workspace: 'apps/server', filters: ['src/features/forms/', 'src/features/notices/'] },
        { workspace: 'packages/team-time', filters: null },
        { workspace: 'apps/web', filters: ['src/features/notifications/'] },
        { workspace: 'tests/e2e', filters: null },
      ],
    },
  );
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
    assert.equal(planTests([file]).all, true, file);
  }
});

test('only docs and Markdown means no unit tests', () => {
  assert.deepEqual(planTests(['docs/decisions/0400-extras.md', 'packages/learning/README.md']), {
    all: false,
    runs: [],
  });
  assert.deepEqual(commandsFor({ all: false, runs: [] }), []);
});
