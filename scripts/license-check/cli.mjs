// @ts-check
// Command line for the license check: node scripts/license-check.mjs [--notices] [--root <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareText, scanInstalled } from './inventory.mjs';
import { licenseFiles, renderNotices, repositoryUrl } from './notices.mjs';
import { evaluatePackage, loadPolicy } from './policy.mjs';

/** @typedef {{ pkg: import('./inventory.mjs').InstalledPackage, verdict: import('./policy.mjs').Verdict }} Checked */

const HELP = `Usage: node scripts/license-check.mjs [--notices] [--root <dir>]

Checks every installed package against docs/decisions/0001-license-policy.md (lists in
license-policy.json) and exits with 1 on any problem. --notices also writes
THIRD_PARTY_NOTICES.md for the shipped packages. --root defaults to the repository root.
`;

/**
 * "MIT 40, ISC 3, and 2 more": packages per license, most common first.
 *
 * @param {Checked[]} checked
 */
function summary(checked) {
  /** @type {Map<string, Set<string>>} */
  const byLicense = new Map();
  for (const { pkg, verdict } of checked) {
    byLicense.set(
      verdict.license,
      (byLicense.get(verdict.license) ?? new Set()).add(`${pkg.name}@${pkg.version}`),
    );
  }
  const counts = [...byLicense].map(([license, ids]) => ({ license, count: ids.size }));
  counts.sort((a, b) => b.count - a.count || compareText(a.license, b.license));
  const shown = counts.slice(0, 8).map(({ license, count }) => `${license} ${count}`);
  const more = counts.length > shown.length ? `, and ${counts.length - shown.length} more` : '';
  return shown.length === 0 ? 'none' : `${shown.join(', ')}${more}`;
}

/**
 * Runs the check.
 *
 * @param {{ argv?: string[], log?: (text: string) => void }} [options]
 * @returns {number} 0 when everything is allowed, 1 on problems, 2 when the check cannot run.
 */
export function main({
  argv = process.argv.slice(2),
  log = (text) => process.stdout.write(text),
} = {}) {
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  let notices = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--notices') notices = true;
    else if (arg === '--root' && argv[i + 1]) root = path.resolve(argv[(i += 1)] ?? '');
    else {
      log(arg === '--help' ? HELP : `Unknown option: ${arg}\n\n${HELP}`);
      return arg === '--help' ? 0 : 2;
    }
  }

  /** @type {Checked[]} */
  let checked;
  /** @type {import('./inventory.mjs').Inventory} */
  let inventory;
  /** @type {import('./policy.mjs').Policy} */
  let policy;
  try {
    policy = loadPolicy(path.join(root, 'license-policy.json'));
    inventory = scanInstalled(root);
    checked = inventory.packages.map((pkg) => ({
      pkg,
      verdict: evaluatePackage(
        { ...pkg.manifest, name: pkg.name, version: pkg.version },
        pkg.scope,
        policy,
      ),
    }));
  } catch (error) {
    log(`License check could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  const shipped = checked.filter(({ pkg }) => pkg.scope === 'shipped');
  const dev = checked.filter(({ pkg }) => pkg.scope === 'dev');
  if (notices) {
    /** @type {Map<string, import('./notices.mjs').NoticeEntry>} */
    const entries = new Map();
    for (const { pkg, verdict } of shipped) {
      const { name, version, dir, manifest } = pkg;
      if (!entries.has(`${name}@${version}`)) {
        const entry = {
          name,
          version,
          license: verdict.license,
          repository: repositoryUrl(manifest.repository),
          files: licenseFiles(dir),
        };
        entries.set(`${name}@${version}`, entry);
      }
    }
    fs.writeFileSync(
      path.join(inventory.root, 'THIRD_PARTY_NOTICES.md'),
      renderNotices([...entries.values()]),
    );
    log(`Wrote THIRD_PARTY_NOTICES.md (${entries.size} shipped packages).\n`);
  }

  /** @type {Map<string, string[]>} problem line -> locations */
  const problems = new Map();
  for (const { pkg, verdict } of checked) {
    for (const problem of verdict.problems) {
      const line = `${pkg.scope === 'shipped' ? 'shipped' : 'dev    '}  ${pkg.name}@${pkg.version}: ${problem}`;
      problems.set(line, [...(problems.get(line) ?? []), pkg.relDir]);
    }
  }
  const lines = [...problems].map(
    ([line, at]) => `${line} (${at[0]}${at.length > 1 ? ` and ${at.length - 1} more` : ''})`,
  );
  lines.push(
    ...inventory.missing.map(
      (dependency) => `shipped  ${dependency}: not installed, so its license cannot be checked`,
    ),
  );
  const used = new Set(checked.map(({ verdict }) => verdict.exception));
  const count = (/** @type {Checked[]} */ items) =>
    new Set(items.map(({ pkg }) => `${pkg.name}@${pkg.version}`)).size;

  log(
    [
      'License check (docs/decisions/0001-license-policy.md)',
      `Third-party packages: ${count(checked)} (${count(shipped)} shipped, ${count(dev)} dev-only)`,
      `Shipped:  ${summary(shipped)}`,
      `Dev-only: ${summary(dev)}`,
      ...policy.exceptions.map(
        (e) =>
          `Exception for ${e.name}${e.version ? `@${e.version}` : ''}: ${used.has(e) ? 'applied' : 'unused, remove it'}`,
      ),
      '',
      lines.length === 0
        ? '✓ No license problems.'
        : `✗ ${lines.length} license problem${lines.length === 1 ? '' : 's'}:`,
      ...lines.map((line) => `  ${line}`),
      ...(lines.length === 0
        ? []
        : [
            '',
            'Replace or remove the package. Changing license-policy.json needs a new decision record.',
          ]),
      '',
    ].join('\n'),
  );
  return lines.length === 0 ? 0 : 1;
}
