import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../../../scripts/license-check/cli.mjs';
import { link, makeTree, manifest, removeTrees, writeTree } from '../support/tree.js';

afterEach(removeTrees);

const policy = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('../../../license-policy.json', import.meta.url)), 'utf8'),
);

function repo(extra: Record<string, string | object> = {}): string {
  const root = makeTree({
    'license-policy.json': policy,
    'package.json': {
      name: 'carehub',
      private: true,
      workspaces: ['apps/*'],
      devDependencies: { 'test-tool': '1' },
    },
    'apps/web/package.json': { name: '@carehub/web', dependencies: { 'ui-lib': '1' } },
    'node_modules/ui-lib/package.json': manifest('ui-lib', '1.2.3', {
      repository: 'octo/ui-lib',
      dependencies: { tiny: '1' },
    }),
    'node_modules/ui-lib/LICENSE': 'MIT License\n\nCopyright (c) Fictional Authors',
    'node_modules/tiny/package.json': manifest('tiny', '0.1.0', { license: 'ISC' }),
    'node_modules/test-tool/package.json': manifest('test-tool', '4.0.0', { license: 'CC0-1.0' }),
    ...extra,
  });
  link(root, 'node_modules/@carehub/web', 'apps/web');
  return root;
}

function run(...argv: string[]): { code: number; output: string } {
  let output = '';
  const code = main({ argv, log: (text) => (output += text) });
  return { code, output };
}

describe('license check command', () => {
  it('passes when every package is allowed', () => {
    const root = repo();
    const { code, output } = run('--root', root);
    expect(code).toBe(0);
    expect(output).toContain('Third-party packages: 3 (2 shipped, 1 dev-only)');
    expect(output).toContain('Shipped:  ISC 1, MIT 1');
    expect(output).toContain('Dev-only: CC0-1.0 1');
    expect(output).toContain('✓ No license problems.');
    expect(fs.existsSync(path.join(root, 'THIRD_PARTY_NOTICES.md'))).toBe(false);
  });

  it('fails with one line per problem and says where the package is', () => {
    const root = repo({
      'node_modules/tiny/package.json': manifest('tiny', '0.1.0', { license: 'GPL-3.0-only' }),
      'node_modules/test-tool/node_modules/tiny/package.json': manifest('tiny', '0.1.0', {
        license: 'GPL-3.0-only',
      }),
      'node_modules/test-tool/package.json': manifest('test-tool', '4.0.0', {
        license: 'CC0-1.0',
        dependencies: { tiny: '1' },
      }),
      'apps/web/package.json': {
        name: '@carehub/web',
        dependencies: { 'ui-lib': '1', absent: '1' },
      },
    });
    const { code, output } = run('--root', root);
    expect(code).toBe(1);
    expect(output).toContain('✗ 3 license problems:');
    expect(output).toContain(
      '  shipped  tiny@0.1.0: GPL-3.0-only is blocked (GPL) (node_modules/tiny)',
    );
    expect(output).toContain(
      '  dev      tiny@0.1.0: GPL-3.0-only is blocked (GPL) (node_modules/test-tool/node_modules/tiny)',
    );
    expect(output).toContain(
      '  shipped  absent (required by @carehub/web): not installed, so its license cannot be checked',
    );
  });

  it('writes THIRD_PARTY_NOTICES.md for shipped packages only', () => {
    const root = repo();
    const { code, output } = run('--notices', '--root', root);
    expect(code).toBe(0);
    expect(output).toContain('Wrote THIRD_PARTY_NOTICES.md (2 shipped packages).');
    const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(notices).toContain(
      '## ui-lib 1.2.3\n\n- License: MIT\n- Repository: https://github.com/octo/ui-lib\n',
    );
    expect(notices).toContain('Copyright (c) Fictional Authors');
    expect(notices).toContain('## tiny 0.1.0');
    expect(notices).not.toContain('test-tool');
  });

  it('reports applied and unused exceptions', () => {
    const exceptions = [
      {
        name: 'tiny',
        version: '0.1.0',
        license: 'ISC',
        reason: 'Fictional: LICENSE file checked by hand.',
      },
      { name: 'gone', license: 'MIT', reason: 'Fictional: the package is no longer installed.' },
    ];
    const root = repo({
      'license-policy.json': { ...policy, exceptions },
      'node_modules/tiny/package.json': manifest('tiny', '0.1.0', {
        license: 'SEE LICENSE IN LICENSE',
      }),
    });
    const { code, output } = run('--root', root);
    expect(output).toContain('Exception for tiny@0.1.0: applied');
    expect(output).toContain('Exception for gone: unused, remove it');
    expect(code).toBe(0);
  });

  it('exits with 2 when it cannot run', () => {
    expect(run('--root', makeTree({ 'package.json': {} }))).toMatchObject({ code: 2 });
    expect(run('--root', makeTree({ 'package.json': {} })).output).toContain(
      'License check could not run: ENOENT',
    );
    const noModules = repo();
    fs.rmSync(path.join(noModules, 'node_modules'), { recursive: true });
    expect(run('--root', noModules).output).toContain('run npm install first');
    const badPolicy = repo();
    writeTree(badPolicy, { 'license-policy.json': { allowed: {} } });
    expect(run('--root', badPolicy)).toMatchObject({ code: 2 });
    const unknown = run('--unknown');
    expect(unknown.code).toBe(2);
    expect(unknown.output).toMatch(/^Unknown option: --unknown\n/);
  });

  it('prints help', () => {
    const { code, output } = run('--help');
    expect(code).toBe(0);
    expect(output).toContain('Usage: node scripts/license-check.mjs [--notices] [--root <dir>]');
  });
});
