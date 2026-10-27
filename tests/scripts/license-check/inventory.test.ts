import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolvePackage,
  runtimeDependencies,
  scanInstalled,
  workspaceDirs,
} from '../../../scripts/license-check/inventory.mjs';
import { link, makeTree, manifest, removeTrees } from '../support/tree.js';

afterEach(removeTrees);

/** A small monorepo: two workspaces, hoisted and nested packages, peers and a missing dependency. */
function monorepo(): string {
  const root = makeTree({
    'package.json': {
      name: 'carehub',
      private: true,
      workspaces: ['apps/*', 'packages/*'],
      devDependencies: { a: '1', d: '1' },
    },
    'apps/server/package.json': {
      name: '@carehub/server',
      dependencies: { a: '2', '@scope/b': '1', '@carehub/ui': '*', missing: '1' },
    },
    'apps/README.md': 'not a workspace',
    'apps/empty/notes.txt': 'no package.json, so not a workspace',
    'packages/ui/package.json': {
      name: '@carehub/ui',
      dependencies: { e: '1' },
      devDependencies: { c: '1' },
    },
    'apps/server/node_modules/a/package.json': manifest('a', '2.0.0', { dependencies: { e: '1' } }),
    'node_modules/a/package.json': manifest('a', '1.0.0'),
    'node_modules/@scope/b/package.json': manifest('@scope/b', '1.0.0', {
      peerDependencies: { f: '1', g: '1' },
      peerDependenciesMeta: { g: { optional: true } },
      optionalDependencies: { h: '1' },
    }),
    'node_modules/c/package.json': manifest('c', '1.0.0', { dependencies: { e: '2' } }),
    'node_modules/c/node_modules/e/package.json': manifest('e', '2.0.0'),
    'node_modules/d/package.json': manifest('d', '1.0.0'),
    'node_modules/e/package.json': manifest('e', '1.0.0'),
    'node_modules/f/package.json': manifest('f', '1.0.0'),
    'node_modules/g/package.json': manifest('g', '1.0.0'),
    'node_modules/.bin/tool': '#!/bin/sh\n',
    'node_modules/.package-lock.json': '{}',
  });
  link(root, 'node_modules/@carehub/server', 'apps/server');
  link(root, 'node_modules/@carehub/ui', 'packages/ui');
  link(root, 'node_modules/broken', 'nowhere');
  return root;
}

describe('workspaceDirs', () => {
  it('expands "*" and skips folders without a package.json', () => {
    const root = monorepo();
    const dirs = workspaceDirs(root, { workspaces: ['apps/*', './packages/*', 'packages/ui'] });
    expect(dirs).toEqual([path.join(root, 'apps/server'), path.join(root, 'packages/ui')]);
    expect(workspaceDirs(root, { workspaces: { packages: ['packages/*'] } })).toEqual([
      path.join(root, 'packages/ui'),
    ]);
    expect(workspaceDirs(root, {})).toEqual([]);
  });
});

describe('resolvePackage', () => {
  it('searches from the package folder up to the root, like Node', () => {
    const root = monorepo();
    expect(resolvePackage(path.join(root, 'apps/server'), 'a', root)).toBe(
      path.join(root, 'apps/server/node_modules/a'),
    );
    expect(resolvePackage(path.join(root, 'packages/ui'), 'a', root)).toBe(
      path.join(root, 'node_modules/a'),
    );
    expect(resolvePackage(path.join(root, 'node_modules/c'), 'e', root)).toBe(
      path.join(root, 'node_modules/c/node_modules/e'),
    );
    expect(resolvePackage(path.join(root, 'node_modules/@scope/b'), 'f', root)).toBe(
      path.join(root, 'node_modules/f'),
    );
    expect(resolvePackage(path.join(root, 'node_modules/@carehub/ui'), 'e', root)).toBe(
      path.join(root, 'node_modules/e'),
    );
    expect(resolvePackage(root, 'missing', root)).toBeNull();
  });

  it('does not look above the root', () => {
    const outer = makeTree({
      'node_modules/outside/package.json': manifest('outside', '1.0.0'),
      'repo/package.json': {},
    });
    const root = path.join(outer, 'repo');
    expect(resolvePackage(root, 'outside', root)).toBeNull();
  });
});

describe('runtimeDependencies', () => {
  it('marks optional dependencies and peers as optional and skips optional peers', () => {
    expect(
      runtimeDependencies({
        dependencies: { a: '1' },
        optionalDependencies: { b: '1' },
        peerDependencies: { c: '1', d: '1' },
        peerDependenciesMeta: { d: { optional: true } },
        devDependencies: { e: '1' },
      }),
    ).toEqual([
      ['c', true],
      ['a', false],
      ['b', true],
    ]);
  });
});

describe('scanInstalled', () => {
  it('finds every installed package and marks what the app ships', () => {
    const root = monorepo();
    const inventory = scanInstalled(root);
    expect(inventory.root).toBe(root);
    expect(inventory.workspaces.map(({ name }) => name)).toEqual([
      'carehub',
      '@carehub/server',
      '@carehub/ui',
    ]);
    expect(
      inventory.packages.map(
        ({ name, version, relDir, scope }) => `${name}@${version} ${relDir} ${scope}`,
      ),
    ).toEqual([
      '@scope/b@1.0.0 node_modules/@scope/b shipped',
      'a@1.0.0 node_modules/a dev',
      'a@2.0.0 apps/server/node_modules/a shipped',
      'c@1.0.0 node_modules/c dev',
      'd@1.0.0 node_modules/d dev',
      'e@1.0.0 node_modules/e shipped',
      'e@2.0.0 node_modules/c/node_modules/e dev',
      'f@1.0.0 node_modules/f shipped',
      'g@1.0.0 node_modules/g dev',
    ]);
    expect(inventory.missing).toEqual(['missing (required by @carehub/server)']);
  });

  it('reports a missing dependency of an installed package with its version', () => {
    const root = makeTree({
      'package.json': { name: 'carehub', dependencies: { a: '1' } },
      'node_modules/a/package.json': manifest('a', '1.0.0', { dependencies: { gone: '1' } }),
    });
    expect(scanInstalled(root).missing).toEqual(['gone (required by a@1.0.0)']);
  });

  it('needs a package.json and installed packages', () => {
    const empty = makeTree({ 'README.md': 'nothing here' });
    expect(() => scanInstalled(empty)).toThrow('no package.json in');
    fs.writeFileSync(path.join(empty, 'package.json'), '{}');
    expect(() => scanInstalled(empty)).toThrow('run npm install first');
  });
});
