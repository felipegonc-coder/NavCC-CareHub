// Tests for check-workspaces.mjs, with Node's test runner and only its built-in modules, so CI
// runs them before npm ci: node --test scripts/check-workspaces.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkWorkspaces } from './check-workspaces.mjs';

const script = fileURLToPath(new URL('./check-workspaces.mjs', import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), 'check-workspaces-'));
after(() => rmSync(temp, { recursive: true, force: true }));

const registry = 'https://registry.npmjs.org';

/**
 * A fictional repository like this one: a server and a web app that use a shared package, a
 * folder without a package.json, and a lockfile with links. Returns its files by path.
 * @returns {Record<string, any>}
 */
function files() {
  return {
    'package.json': {
      name: 'carehub',
      private: true,
      workspaces: ['apps/*', 'packages/*'],
      devDependencies: { typescript: '~5.9' },
    },
    'apps/server/package.json': {
      name: '@carehub/server',
      dependencies: { '@carehub/shared': '*', fastify: '^5' },
    },
    'apps/web/package.json': {
      name: '@carehub/web',
      dependencies: { '@carehub/shared': '*' },
      devDependencies: { '@carehub/server': '*' },
    },
    'packages/shared/package.json': { name: '@carehub/shared' },
    'packages/notes/README.md': 'Not a workspace: no package.json.',
    'package-lock.json': {
      name: 'carehub',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: 'carehub', workspaces: ['apps/*', 'packages/*'] },
        'apps/server': { name: '@carehub/server' },
        'apps/web': { name: '@carehub/web' },
        'node_modules/@carehub/server': { resolved: 'apps/server', link: true },
        'node_modules/@carehub/shared': { resolved: 'packages/shared', link: true },
        'node_modules/@carehub/web': { resolved: 'apps/web', link: true },
        'node_modules/fastify': {
          version: '5.0.0',
          resolved: `${registry}/fastify/-/fastify-5.0.0.tgz`,
          integrity: 'sha512-fictional',
        },
        'packages/shared': { name: '@carehub/shared' },
      },
    },
  };
}

let count = 0;

/**
 * Writes a repository to a new folder and returns the folder.
 * @param {(files: Record<string, any>) => void} [change] edits the files first
 */
function repository(change) {
  const all = files();
  change?.(all);
  count += 1;
  const root = path.join(temp, String(count));
  for (const [file, content] of Object.entries(all)) {
    if (content === undefined) continue;
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    const text = typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`;
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

/**
 * The check's errors for a changed repository; asserts that there are no warnings.
 * @param {(files: Record<string, any>) => void} change
 */
function errorsAfter(change) {
  const result = checkWorkspaces(repository(change));
  assert.deepEqual(result.warnings, []);
  return result.errors;
}

test('passes when every @carehub/* package is a workspace link', () => {
  assert.deepEqual(checkWorkspaces(repository()), {
    errors: [],
    warnings: [],
    dependencies: 3,
    lockEntries: 3,
  });
});

test('fails on a dependency that names no workspace', () => {
  const errors = errorsAfter((f) => {
    f['apps/server/package.json'].dependencies = { '@carehub/sharde': '*' };
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? '', /^apps\/server\/package\.json: dependencies\["@carehub\/sharde"\]/);
  assert.match(errors[0] ?? '', /no workspace has that name/);
});

test('checks the root package.json and every dependency field', () => {
  const errors = errorsAfter((f) => {
    f['package.json'].devDependencies['@carehub/tools'] = '*';
    f['apps/web/package.json'].peerDependencies = { '@carehub/ui': '*' };
    f['apps/web/package.json'].optionalDependencies = { '@carehub/maps': '*' };
  });
  assert.equal(errors.length, 3);
  assert.match(errors[0] ?? '', /^package\.json: devDependencies\["@carehub\/tools"\]/);
  assert.match(
    errors[1] ?? '',
    /^apps\/web\/package\.json: optionalDependencies\["@carehub\/maps"\]/,
  );
  assert.match(errors[2] ?? '', /^apps\/web\/package\.json: peerDependencies\["@carehub\/ui"\]/);
});

test('fails on a range other than "*"', () => {
  const errors = errorsAfter((f) => {
    f['apps/server/package.json'].dependencies['@carehub/shared'] = '^1.0.0';
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? '', /\["@carehub\/shared"\] is "\^1\.0\.0"\. Use "\*"/);
});

test('fails on an npm: alias of a @carehub/* name', () => {
  const errors = errorsAfter((f) => {
    f['apps/web/package.json'].dependencies.shared = 'npm:@carehub/shared@*';
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? '', /\["shared"\] is "npm:@carehub\/shared@\*", an npm: alias/);
});

test('fails on a lockfile entry from the registry', () => {
  const errors = errorsAfter((f) => {
    f['package-lock.json'].packages['node_modules/@carehub/shared'] = {
      version: '9.9.9',
      resolved: `${registry}/@carehub/shared/-/shared-9.9.9.tgz`,
      integrity: 'sha512-fictional',
    };
  });
  assert.deepEqual(errors, [
    `package-lock.json: "node_modules/@carehub/shared" is installed from ` +
      `${registry}/@carehub/shared/-/shared-9.9.9.tgz, not linked to a workspace.`,
  ]);
});

test('fails on a nested lockfile entry that is not a link', () => {
  const errors = errorsAfter((f) => {
    f['package-lock.json'].packages['apps/web/node_modules/@carehub/shared'] = {
      version: '1.0.0',
    };
  });
  assert.deepEqual(errors, [
    'package-lock.json: "apps/web/node_modules/@carehub/shared" is installed from the registry, ' +
      'not linked to a workspace.',
  ]);
});

test('fails on a link outside the workspace folders', () => {
  for (const resolved of ['../elsewhere/shared', 'vendor/shared', 'packages/shared/inner']) {
    const errors = errorsAfter((f) => {
      f['package-lock.json'].packages['node_modules/@carehub/shared'].resolved = resolved;
    });
    assert.equal(errors.length, 1, resolved);
    assert.match(errors[0] ?? '', /isn't a workspace folder \(apps\/\*, packages\/\*\)/);
  }
});

test('only warns on an out-of-date link into a workspace folder', () => {
  const result = checkWorkspaces(
    repository((f) => {
      f['package-lock.json'].packages['node_modules/@carehub/old'] = {
        resolved: 'packages/old',
        link: true,
      };
    }),
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? '', /links to packages\/old, which isn't the workspace/);
});

test('fails without package-lock.json', () => {
  const errors = errorsAfter((f) => {
    f['package-lock.json'] = undefined;
  });
  assert.deepEqual(errors, ['package-lock.json is missing.']);
});

test('fails on two workspaces with the same name', () => {
  const errors = errorsAfter((f) => {
    f['packages/shared-copy/package.json'] = { name: '@carehub/shared' };
  });
  assert.deepEqual(errors, [
    'packages/shared/package.json and packages/shared-copy/package.json are both named @carehub/shared.',
  ]);
});

test('fails on a workspace pattern it does not understand', () => {
  const errors = errorsAfter((f) => {
    f['package.json'].workspaces = ['apps/*', 'packages/**'];
  });
  assert.ok(errors.some((e) => e.includes('not "packages/**"')));
});

test('the command exits with 0 when the check passes and 1 when it fails', () => {
  const passed = spawnSync(process.execPath, [script, repository()], { encoding: 'utf8' });
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /^Workspace check passed: 3 @carehub\/\* dependencies/);

  const failed = spawnSync(
    process.execPath,
    [
      script,
      repository((f) => {
        f['apps/server/package.json'].dependencies['@carehub/sharde'] = '*';
      }),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /^Workspace check failed\./);
  assert.match(failed.stderr, /- apps\/server\/package\.json: dependencies\["@carehub\/sharde"\]/);

  const broken = spawnSync(
    process.execPath,
    [
      script,
      repository((f) => {
        f['packages/shared/package.json'] = '{ "name": ';
      }),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /^Workspace check: Can't read packages\/shared\/package\.json: /);
});
