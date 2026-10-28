#!/usr/bin/env node
// Load test (README.md, in this folder): about 30 people use Care Hub at once. Each one opens it
// like a first-time visitor, signs in with a fictional test account, then opens pages, uses the
// sidebar and searches. The report has p50 and p95 times for each step and every refused or failed
// request. The budget: page opens within 1 second at p95, and no refused steps or server errors.
//
//   LOAD_PASSWORD=<the test accounts' password> node scripts/load/run.mjs --url <address>
//
// Only Node's built-in modules. A step whose route answers 404 isn't on that build yet: it is
// skipped and listed. Exit code 0: within the budget; 1: over it, or steps were refused or failed;
// 2: it couldn't run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Browser, outcomeOf, problemOf } from './client.mjs';
import { Person, STEPS, pagesIn, spaceIdsIn } from './person.mjs';
import { filesSummary, markdown } from './report.mjs';
import { PAGE_OPEN, Recorder, verdict } from './stats.mjs';

/**
 * @typedef {import('./person.mjs').Features} Features
 * @typedef {import('./person.mjs').PageRef} PageRef
 * @typedef {object} Options
 * @property {string} url
 * @property {number} people
 * @property {number} duration seconds
 * @property {number} ramp seconds over which the people arrive
 * @property {number} pause milliseconds, the average pause between a person's actions
 * @property {number} budget milliseconds, the page-open p95 budget
 * @property {string[]} accounts the people take turns with these
 * @property {string} password
 * @property {string | null} report a folder for load-report.json and load-report.md
 */

/** The seeded people (decision 0007, section 2.5). */
const SEEDED = ['avery.admin', 'eli.editor', 'casey.commenter', 'val.viewer'];
/** With fewer pages to open than this, the test adds fictional ones to the first space. */
const MIN_PAGES = 10;
const TITLES = ['Care plan', 'Shift notes', 'Team handbook', 'Visit checklist', 'Training guide'];

export const USAGE = `Usage: LOAD_PASSWORD=<password> node scripts/load/run.mjs [options]

  --url <address>       Care Hub to test (LOAD_URL, default http://127.0.0.1:3000)
  --people <n>          people at once (LOAD_PEOPLE, default 30)
  --duration <s>        how long the run lasts (LOAD_DURATION, default 60)
  --ramp <s>            the people arrive over this time (default 15)
  --pause <ms>          average pause between a person's actions (default 2000)
  --budget <ms>         page-open p95 budget (default 1000)
  --accounts <emails>   comma-separated @example.test accounts (LOAD_ACCOUNTS, default the
                        seeded people); the password is LOAD_PASSWORD or CAREHUB_SEED_PASSWORD
  --report <folder>     also write load-report.json and load-report.md there (LOAD_REPORT_DIR)`;

/** A reason the test can't run, for the person running it. */
class Stop extends Error {}

/**
 * @param {string} name
 * @param {string | undefined} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 */
function whole(name, value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Stop(`--${name} must be a whole number from ${min} to ${max}, not "${value}".`);
  }
  return n;
}

/**
 * @param {string[]} args
 * @param {Record<string, string | undefined>} env
 * @returns {Options | null} null for --help
 */
export function parseOptions(args, env) {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      url: { type: 'string' },
      people: { type: 'string' },
      duration: { type: 'string' },
      ramp: { type: 'string' },
      pause: { type: 'string' },
      budget: { type: 'string' },
      accounts: { type: 'string' },
      report: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return null;
  const url = values.url ?? env.LOAD_URL ?? 'http://127.0.0.1:3000';
  if (!/^https?:\/\//.test(url) || !URL.canParse(url)) {
    throw new Stop(`--url must be an http or https address, not "${url}".`);
  }
  const list = values.accounts ?? env.LOAD_ACCOUNTS;
  const accounts = list
    ? list
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean)
    : SEEDED.map((name) => `${name}@example.test`);
  const real = accounts.find((email) => !/^[^\s@]+@example\.test$/i.test(email));
  if (real !== undefined || accounts.length === 0) {
    throw new Stop('--accounts takes only fictional test accounts, ending in @example.test.');
  }
  const password = env.LOAD_PASSWORD || env.CAREHUB_SEED_PASSWORD;
  if (!password) {
    throw new Stop("Set LOAD_PASSWORD (or CAREHUB_SEED_PASSWORD) to the test accounts' password.");
  }
  return {
    url,
    accounts,
    password,
    people: whole('people', values.people ?? env.LOAD_PEOPLE, 30, 1, 200),
    duration: whole('duration', values.duration ?? env.LOAD_DURATION, 60, 1, 3600),
    ramp: whole('ramp', values.ramp, 15, 0, 600),
    pause: whole('pause', values.pause, 2000, 100, 60_000),
    budget: whole('budget', values.budget, 1000, 100, 60_000),
    report: values.report ?? env.LOAD_REPORT_DIR ?? null,
  };
}

/**
 * Finds out what this build has, signed in as the first account, and adds fictional pages to the
 * first space when there are too few to open. A route that answers 404 isn't on this build yet.
 * @param {Options} options
 * @param {Recorder} recorder
 * @returns {Promise<{ version: string | null, features: Features }>}
 */
export async function prepare(options, recorder) {
  const browser = new Browser(options.url);
  const health = await browser.send('GET', '/api/health');
  if (outcomeOf(health) !== 'ok') {
    throw new Stop(`${options.url} didn't answer /api/health (${health.error ?? health.status}).`);
  }
  const body = /** @type {{ version?: unknown } | null} */ (health.body);
  const version = typeof body?.version === 'string' ? body.version : null;
  /** @type {Features} */
  const features = { signIn: false, spaces: false, tree: false, pages: false, search: false };
  /** @type {[keyof Features, string[], string][]} */
  const needs = [
    ['signIn', [STEPS.signIn, STEPS.appStart, STEPS.sidebar, PAGE_OPEN, STEPS.search], 'sign-in'],
    ['spaces', [STEPS.sidebar, PAGE_OPEN], 'GET /api/spaces'],
    ['tree', [PAGE_OPEN], 'the sidebar tree (GET /api/spaces/:id/tree)'],
    ['pages', [PAGE_OPEN], 'GET /api/pages/:id'],
    ['search', [STEPS.search], 'POST /api/search/query'],
  ];
  try {
    await find(browser, options, features, recorder);
  } finally {
    if (features.signIn) await browser.send('POST', '/api/auth/sign-out');
  }
  for (const [feature, steps, what] of needs) {
    if (!features[feature]) for (const step of steps) recorder.skip(step, `needs ${what}`);
  }
  return { version, features };
}

/**
 * True when the route answered, false when it isn't on this build (404). Anything else stops the
 * test: the server can't be measured like that.
 * @param {string} route
 * @param {import('./client.mjs').Answer} answer
 */
function answered(route, answer) {
  if (answer.status === 404) return false;
  if (outcomeOf(answer) === 'ok') return true;
  throw new Stop(`${problemOf(route, answer)} while the test was getting ready.`);
}

/**
 * @param {Browser} browser
 * @param {Options} options
 * @param {Features} features set to what this build has
 * @param {Recorder} recorder
 */
async function find(browser, options, features, recorder) {
  const email = options.accounts[0] ?? '';
  await browser.send('GET', '/api/auth/me');
  const json = { email, password: options.password };
  const signIn = await browser.send('POST', '/api/auth/sign-in', { json });
  if (signIn.status === 404) return;
  if (outcomeOf(signIn) !== 'ok') {
    const why = signIn.error ?? `it answered ${signIn.status}`;
    throw new Stop(`Couldn't sign in as ${email}: ${why}. Is the password right, and seeded?`);
  }
  features.signIn = true;
  const search = await browser.send('POST', '/api/search/query', { json: { text: 'care' } });
  features.search = answered('POST /api/search/query', search);
  const spaces = await browser.send('GET', '/api/spaces');
  features.spaces = answered('GET /api/spaces', spaces);
  const spaceIds = spaceIdsIn(spaces.body);
  if (!features.spaces) return;
  if (spaceIds.length === 0) {
    recorder.skip(PAGE_OPEN, `${email} has no spaces in the sidebar`);
    return;
  }
  const trees = await Promise.all(
    spaceIds.map((id) => browser.send('GET', `/api/spaces/${id}/tree`)),
  );
  features.tree = trees.every((tree) => answered('GET /api/spaces/:id/tree', tree));
  if (!features.tree) return;
  const pages = trees.flatMap((tree) => pagesIn(tree.body, 'nodes'));
  for (let n = pages.length + 1; n <= MIN_PAGES; n += 1) {
    const title = `${TITLES[n % TITLES.length]} (load test ${n})`;
    const made = await browser.send('POST', '/api/pages', {
      json: { spaceId: spaceIds[0], title },
    });
    const page = /** @type {{ id?: unknown } | null} */ (made.body);
    // Not on this build, or this account may not add pages there: open the ones there are.
    if (outcomeOf(made) !== 'ok' || typeof page?.id !== 'string') break;
    pages.push({ id: page.id, title });
  }
  const [page] = pages;
  if (!page) recorder.skip(PAGE_OPEN, 'there were no pages to open, and none could be added');
  else
    features.pages = answered(
      'GET /api/pages/:id',
      await browser.send('GET', `/api/pages/${page.id}`),
    );
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string[]} args
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<number>} the exit code
 */
export async function main(args, env) {
  let options;
  try {
    options = parseOptions(args, env);
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }
  if (!options) {
    console.log(USAGE);
    return 0;
  }
  const recorder = new Recorder();
  const startedAt = new Date().toISOString();
  let found;
  try {
    found = await prepare(options, recorder);
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    console.error(error.message);
    return 2;
  }
  const endsAt = performance.now() + options.duration * 1000;
  const { accounts, password } = options;
  const people = Array.from(
    { length: options.people },
    (_, i) =>
      new Person({
        baseUrl: options.url,
        account: { email: accounts[i % accounts.length] ?? '', password },
        features: found.features,
        recorder,
        endsAt,
        pauseMs: options.pause,
      }),
  );
  const gap = (options.ramp * 1000) / options.people;
  await Promise.all(people.map((person, i) => sleep(i * gap).then(() => person.run())));
  const order = Object.values(STEPS);
  const steps = recorder.summary().sort((a, b) => order.indexOf(a.step) - order.indexOf(b.step));
  const report = {
    startedAt,
    url: options.url,
    version: found.version,
    people: options.people,
    durationS: options.duration,
    budgetMs: options.budget,
    steps,
    skipped: recorder.skipped(),
    problems: recorder.problems(),
    files: filesSummary(people[0]?.files ?? []),
    verdict: verdict(steps, [{ step: PAGE_OPEN, p95Ms: options.budget }]),
  };
  const text = markdown(report);
  console.log(text);
  if (options.report) {
    mkdirSync(options.report, { recursive: true });
    writeFileSync(join(options.report, 'load-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(options.report, 'load-report.md'), text);
  }
  return report.verdict.passed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
