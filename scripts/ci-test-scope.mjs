// Which unit tests a pull request needs (docs/decisions/0006-ci-within-free-minutes.md).
//
// A pull request that changes only lane folders (AGENTS.md, section 5) runs only those lanes'
// tests. Any other change runs all of them, and so does every run on main. Markdown and docs/
// never count. The "Unit tests" step in .github/workflows/ci.yml runs:
//
//   git diff --name-only --no-renames HEAD^1 HEAD | node scripts/ci-test-scope.mjs --run
//
// Without --run it only prints the plan as JSON.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Lane folders, as in AGENTS.md section 5: lane packages, feature folder names and e2e folders. */
export const LANES = {
  learning: {
    packages: /^packages\/(learning[^/]*)\//,
    features: ['learning'],
    e2e: ['learning'],
  },
  databases: {
    packages: /^packages\/(databases[^/]*)\//,
    features: ['databases', 'forms'],
    e2e: ['databases', 'forms'],
  },
  team: {
    packages: /^packages\/(team-[^/]+)\//,
    features: [
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
      'notifications',
    ],
    e2e: ['team'],
  },
  extras: {
    packages: /^packages\/(extras)\//,
    features: ['search', 'history', 'templates', 'import-export', 'knowledge', 'claude'],
    e2e: ['extras'],
  },
};

/** Never changes what a unit test does. */
const NEUTRAL = /^docs\/|\.md$/;

/**
 * Where a lane file's tests run: a whole lane package, or one feature folder inside an app.
 * Null for anything outside the lane folders, and for any package.json (dependencies can change
 * what every workspace installs).
 */
function laneTarget(file) {
  if (file === 'package.json' || file.endsWith('/package.json')) return null;
  for (const lane of Object.values(LANES)) {
    const pkg = lane.packages.exec(file);
    if (pkg) return { workspace: `packages/${pkg[1]}`, filter: null };
    for (const app of ['server', 'web']) {
      for (const name of lane.features) {
        if (file.startsWith(`apps/${app}/src/features/${name}/`)) {
          return { workspace: `apps/${app}`, filter: `src/features/${name}/` };
        }
      }
    }
    for (const name of lane.e2e) {
      if (file.startsWith(`tests/e2e/${name}/`)) return { workspace: 'tests/e2e', filter: null };
    }
  }
  return null;
}

/**
 * The plan for a list of changed files: { all: true, reason } when every test runs, otherwise
 * { all: false, runs: [{ workspace, filters }] }, where filters null means the whole workspace.
 */
export function planTests(files) {
  const runs = new Map();
  for (const file of files.map((name) => name.trim()).filter(Boolean)) {
    if (NEUTRAL.test(file)) continue;
    const target = laneTarget(file);
    if (!target) return { all: true, reason: file };
    const run = runs.get(target.workspace) ?? { workspace: target.workspace, filters: [] };
    if (target.filter === null) run.filters = null;
    else if (run.filters !== null && !run.filters.includes(target.filter)) run.filters.push(target.filter);
    runs.set(target.workspace, run);
  }
  return { all: false, runs: [...runs.values()] };
}

/** The npm commands for a plan. */
export function commandsFor(plan) {
  if (plan.all) return [['npm', 'run', 'test']];
  return plan.runs.map(({ workspace, filters }) => [
    'npm',
    'run',
    'test',
    '-w',
    workspace,
    '--if-present',
    ...(filters ? ['--', '--passWithNoTests', ...filters] : []),
  ]);
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
    console.log('Only lane folders changed, so only their unit tests run:');
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
