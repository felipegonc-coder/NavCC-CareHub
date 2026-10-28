// Which unit tests a pull request needs (docs/decisions/0006-ci-within-free-minutes.md).
//
// A pull request that changes only lane folders (AGENTS.md, section 5) runs only those lanes'
// tests, plus the core tests that check the wiring every lane depends on. A change to a lane
// package also runs the code that uses it: the lane's feature folders in both apps and every
// workspace that lists the package. Any other change runs all of them, and so does every run on
// main. Markdown and docs/ never count. The "Unit tests" step in .github/workflows/ci.yml runs:
//
//   git diff --name-only --no-renames HEAD^1 HEAD | node scripts/ci-test-scope.mjs --run
//
// Without --run it only prints the plan as JSON.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{ packages: RegExp, server: string[], web: string[], e2e: string[] }} Lane
 *   A lane's folders: its packages, its feature folders in each app and its e2e folders.
 * @typedef {{ workspace: string, filters: string[] | null }} Run
 *   Tests to run in one workspace: vitest path filters, or null for all of them.
 * @typedef {{ all: true, reason: string } | { all: false, runs: Run[] }} Plan
 * @typedef {[string, ...string[]]} Command
 * @typedef {{ dir: string, name: string, dependencies: string[] }} Workspace
 *   A workspace folder, its package name and every package its package.json lists.
 */

const TEAM = [
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
];
const EXTRAS = ['search', 'history', 'templates', 'import-export', 'knowledge', 'claude'];

/**
 * Lane folders, as in AGENTS.md section 5.
 * @type {Record<string, Lane>}
 */
export const LANES = {
  learning: {
    packages: /^packages\/(learning[^/]*)\//,
    server: ['learning'],
    web: ['learning'],
    e2e: ['learning'],
  },
  databases: {
    packages: /^packages\/(databases[^/]*)\//,
    server: ['databases', 'forms'],
    web: ['databases', 'forms'],
    e2e: ['databases', 'forms'],
  },
  team: {
    packages: /^packages\/(team-[^/]+)\//,
    server: TEAM,
    web: [...TEAM, 'notifications'],
    e2e: ['team'],
  },
  extras: {
    packages: /^packages\/(extras)\//,
    server: EXTRAS,
    web: EXTRAS,
    e2e: ['extras'],
  },
};

/**
 * Core tests that every run in that app includes, because a lane change can break them: the
 * server's app and route wiring, sign-in, sessions and CSRF, workspaces, roles and members (the
 * guard matrix), page access (lanes register access resolvers), and the web app's routes and
 * slots.
 * @type {Record<string, string[]>}
 */
export const CORE_TESTS = {
  'apps/server': [
    'src/app.test.ts',
    'src/core/',
    'src/features/auth/',
    'src/features/workspaces/',
    'src/features/roles/',
    'src/features/pages/',
  ],
  'apps/web': ['src/routes.test.tsx', 'src/slots.test.ts'],
};

/** Never changes what a unit test does. */
const NEUTRAL = /^docs\/|\.md$/;

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * The workspaces (apps/*, packages/*, tests/*), with the packages each one lists.
 * @param {string} [root]
 * @returns {Workspace[]}
 */
export function readWorkspaces(root = '.') {
  /** @type {Workspace[]} */
  const found = [];
  for (const group of ['apps', 'packages', 'tests']) {
    for (const name of listDir(join(root, group))) {
      const dir = `${group}/${name}`;
      /** @type {any} */
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
      } catch {
        continue;
      }
      const dependencies = Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
        ...manifest.optionalDependencies,
      });
      found.push({ dir, name: String(manifest.name ?? ''), dependencies });
    }
  }
  return found;
}

/**
 * Every workspace that lists the package in `dir`, directly or through another workspace.
 * @param {string} dir
 * @param {Workspace[]} workspaces
 * @returns {string[]}
 */
export function dependentsOf(dir, workspaces) {
  const names = new Map(workspaces.map((workspace) => [workspace.dir, workspace.name]));
  const seen = new Set([dir]);
  const queue = [dir];
  /** @type {string[]} */
  const found = [];
  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    const name = names.get(current);
    if (!name) continue;
    for (const workspace of workspaces) {
      if (seen.has(workspace.dir) || !workspace.dependencies.includes(name)) continue;
      seen.add(workspace.dir);
      found.push(workspace.dir);
      queue.push(workspace.dir);
    }
  }
  return found;
}

/**
 * The lane a lane package belongs to, from its folder (`packages/team-time`).
 * @param {string} dir
 * @returns {Lane | undefined}
 */
function laneOfPackage(dir) {
  return Object.values(LANES).find((lane) => lane.packages.test(`${dir}/`));
}

/**
 * A lane's feature folders in both apps.
 * @param {Lane} lane
 * @returns {{ workspace: string, filter: string }[]}
 */
function featureTargets(lane) {
  return [
    ...lane.server.map((name) => ({ workspace: 'apps/server', filter: `src/features/${name}/` })),
    ...lane.web.map((name) => ({ workspace: 'apps/web', filter: `src/features/${name}/` })),
  ];
}

/**
 * Where a lane file's tests run, or null for anything outside the lane folders and for any
 * package.json (dependencies can change what every workspace installs). A filter of null means
 * the whole workspace.
 * @param {string} file
 * @param {Workspace[]} workspaces
 * @returns {{ workspace: string, filter: string | null }[] | null}
 */
function laneTargets(file, workspaces) {
  if (file === 'package.json' || file.endsWith('/package.json')) return null;
  for (const lane of Object.values(LANES)) {
    const pkg = lane.packages.exec(file);
    if (pkg) {
      const dir = `packages/${pkg[1]}`;
      /** @type {{ workspace: string, filter: string | null }[]} */
      const targets = [{ workspace: dir, filter: null }, ...featureTargets(lane)];
      for (const dependent of dependentsOf(dir, workspaces)) {
        if (dependent === 'apps/server' || dependent === 'apps/web') continue;
        targets.push({ workspace: dependent, filter: null });
        // A lane package that uses this one: its own lane's feature folders too.
        const other = laneOfPackage(dependent);
        if (other && other !== lane) targets.push(...featureTargets(other));
      }
      return targets;
    }
    for (const app of ['server', 'web']) {
      for (const name of app === 'server' ? lane.server : lane.web) {
        if (file.startsWith(`apps/${app}/src/features/${name}/`)) {
          return [{ workspace: `apps/${app}`, filter: `src/features/${name}/` }];
        }
      }
    }
    for (const name of lane.e2e) {
      if (file.startsWith(`tests/e2e/${name}/`)) return [{ workspace: 'tests/e2e', filter: null }];
    }
  }
  return null;
}

/**
 * The plan for a list of changed files.
 * @param {string[]} files
 * @param {Workspace[]} [workspaces] defaults to the ones in the current folder
 * @returns {Plan}
 */
export function planTests(files, workspaces = readWorkspaces()) {
  /** @type {Map<string, Run>} */
  const runs = new Map();
  for (const file of files.map((name) => name.trim()).filter(Boolean)) {
    if (NEUTRAL.test(file)) continue;
    const targets = laneTargets(file, workspaces);
    if (!targets) return { all: true, reason: file };
    for (const target of targets) {
      const run = runs.get(target.workspace) ?? { workspace: target.workspace, filters: [] };
      if (target.filter === null) run.filters = null;
      else if (run.filters !== null && !run.filters.includes(target.filter)) {
        run.filters.push(target.filter);
      }
      runs.set(target.workspace, run);
    }
  }
  for (const run of runs.values()) {
    const core = CORE_TESTS[run.workspace];
    if (!core || run.filters === null) continue;
    for (const filter of core) if (!run.filters.includes(filter)) run.filters.push(filter);
  }
  return { all: false, runs: [...runs.values()] };
}

/**
 * The npm commands for a plan.
 * @param {Plan} plan
 * @returns {Command[]}
 */
export function commandsFor(plan) {
  if (plan.all) return [['npm', 'run', 'test']];
  return plan.runs.map(({ workspace, filters }) => {
    /** @type {Command} */
    const command = ['npm', 'run', 'test', '-w', workspace, '--if-present'];
    if (filters) command.push('--', '--passWithNoTests', ...filters);
    return command;
  });
}

function main() {
  const files = readFileSync(0, 'utf8').split('\n');
  const plan = planTests(files);
  if (!process.argv.includes('--run')) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  const commands = commandsFor(plan);
  if (plan.all) {
    console.log(`Running every unit test (changed outside the lane folders: ${plan.reason}).`);
  } else if (commands.length === 0) {
    console.log('Only docs or Markdown changed, so no unit tests are affected.');
  } else {
    console.log('Only lane folders changed, so only these unit tests run:');
    for (const command of commands) console.log(`  ${command.join(' ')}`);
  }
  let failed = 0;
  for (const [command, ...args] of commands) {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.status !== 0) failed += 1;
  }
  process.exitCode = failed > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
