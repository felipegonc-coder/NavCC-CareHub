// One simulated person: opens Care Hub like a first-time visitor, signs in, then until the run
// ends opens pages from the sidebar, searches and opens results, refreshes the sidebar and now and
// then reloads, with a pause between actions like someone reading.
import { Browser, outcomeOf, problemOf } from './client.mjs';
import { PAGE_OPEN } from './stats.mjs';

/**
 * @typedef {import('./client.mjs').Answer} Answer
 * @typedef {import('./stats.mjs').Recorder} Recorder
 * @typedef {{ id: string, title: string }} PageRef
 * @typedef {{ signIn: boolean, spaces: boolean, tree: boolean, pages: boolean, search: boolean }}
 *   Features what this build has, found out before the run (run.mjs)
 * @typedef {object} Visit
 * @property {string} baseUrl
 * @property {{ email: string, password: string }} account
 * @property {Features} features
 * @property {Recorder} recorder
 * @property {number} endsAt when to stop, on the performance.now() clock
 * @property {number} pauseMs the average pause between actions
 * @property {number} [timeoutMs]
 */

export const STEPS = {
  firstVisit: 'first visit',
  signIn: 'sign-in',
  appStart: 'app start',
  sidebar: 'sidebar',
  pageOpen: PAGE_OPEN,
  search: 'search',
};

/** Words to search for when the sidebar has no titles to take them from. */
const WORDS = ['care', 'plan', 'notes', 'team'];

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * @template T
 * @param {readonly T[]} list
 * @returns {T | undefined}
 */
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * The files a browser loads with the HTML: scripts, styles, preloads, icons and the manifest.
 * @param {string} html
 */
export function filesIn(html) {
  const found = new Set();
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const path = /\s(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (path?.startsWith('/') && !path.startsWith('//')) found.add(path);
  }
  return [...found];
}

/**
 * The spaces in the sidebar (GET /api/spaces), with the person's Private section.
 * @param {unknown} body
 * @returns {string[]}
 */
export function spaceIdsIn(body) {
  if (!isRecord(body)) return [];
  const spaces = Array.isArray(body.spaces) ? body.spaces : [];
  const ids = spaces.flatMap((space) =>
    isRecord(space) && typeof space.id === 'string' && !space.archivedAt ? [space.id] : [],
  );
  if (typeof body.privateSpaceId === 'string') ids.push(body.privateSpaceId);
  return ids;
}

/**
 * The pages in a sidebar tree (GET /api/spaces/:id/tree) or in search results.
 * @param {unknown} body
 * @param {'nodes' | 'results'} key
 * @returns {PageRef[]}
 */
export function pagesIn(body, key) {
  const list = isRecord(body) && Array.isArray(body[key]) ? body[key] : [];
  return list.flatMap((entry) =>
    isRecord(entry) && entry.kind === 'page' && typeof entry.id === 'string'
      ? [{ id: entry.id, title: typeof entry.title === 'string' ? entry.title : '' }]
      : [],
  );
}

export class Person {
  /** @type {PageRef[]} the pages in this person's sidebar */
  pages = [];
  /** @type {{ path: string, answer: Answer }[]} what the first visit downloaded */
  files = [];

  /** @param {Visit} visit */
  constructor(visit) {
    this.visit = visit;
    this.browser = new Browser(visit.baseUrl, { timeoutMs: visit.timeoutMs });
  }

  /** The whole visit: what it does before the run ends. */
  async run() {
    const { features, endsAt, pauseMs } = this.visit;
    await this.firstVisit();
    if (!features.signIn || !(await this.signIn())) return;
    await this.appStart();
    while (performance.now() < endsAt) {
      await sleep(pauseMs * (0.5 + Math.random()));
      if (performance.now() >= endsAt) break;
      await this.act(Math.random());
    }
  }

  /** @param {number} roll from 0 to 1: which action */
  async act(roll) {
    const { features } = this.visit;
    const page = pick(this.pages);
    if (roll < 0.55 && page && features.pages) await this.openPage(page);
    else if (roll < 0.8 && features.search) await this.search();
    else if (roll < 0.92 || !page) await this.sidebar();
    else await this.appStart();
  }

  /** Nothing cached yet: the HTML and every file it loads. */
  async firstVisit() {
    const started = performance.now();
    const html = await this.browser.send('GET', '/', { accept: 'text/html' });
    /** @type {[string, Answer][]} */
    const answers = [['GET /', html]];
    if (typeof html.body === 'string') {
      const paths = filesIn(html.body);
      const accept = '*/*';
      const files = await Promise.all(
        paths.map((path) => this.browser.send('GET', path, { accept })),
      );
      files.forEach((file, i) => answers.push([`GET ${paths[i]}`, file]));
      this.files = files.map((file, i) => ({ path: paths[i] ?? '', answer: file }));
    }
    return this.#finish(STEPS.firstVisit, started, answers);
  }

  async signIn() {
    const started = performance.now();
    // Signed out, the app asks who's signed in first; the answer brings the CSRF cookie.
    const me = await this.browser.send('GET', '/api/auth/me');
    const { email, password } = this.visit.account;
    const json = { email, password };
    const signIn = await this.browser.send('POST', '/api/auth/sign-in', { json });
    /** @type {[string, Answer][]} */
    const answers = [['POST /api/auth/sign-in', signIn]];
    if (outcomeOf(me) === 'error') answers.unshift(['GET /api/auth/me', me]);
    return this.#finish(STEPS.signIn, started, answers);
  }

  /** A reload, with the files cached: the HTML, who's signed in and the sidebar. */
  async appStart() {
    const started = performance.now();
    const html = await this.browser.send('GET', '/', { accept: 'text/html' });
    const [me, sidebar] = await Promise.all([
      this.browser.send('GET', '/api/auth/me'),
      this.#sidebar(),
    ]);
    /** @type {[string, Answer][]} */
    const answers = [['GET /', html], ['GET /api/auth/me', me], ...sidebar];
    return this.#finish(STEPS.appStart, started, answers);
  }

  async sidebar() {
    if (!this.visit.features.spaces) return false;
    const started = performance.now();
    return this.#finish(STEPS.sidebar, started, await this.#sidebar());
  }

  /** @returns {Promise<[string, Answer][]>} */
  async #sidebar() {
    const { features } = this.visit;
    if (!features.spaces) return [];
    const spaces = await this.browser.send('GET', '/api/spaces');
    /** @type {[string, Answer][]} */
    const answers = [['GET /api/spaces', spaces]];
    if (!features.tree || outcomeOf(spaces) !== 'ok') return answers;
    const trees = await Promise.all(
      spaceIdsIn(spaces.body).map((id) => this.browser.send('GET', `/api/spaces/${id}/tree`)),
    );
    for (const tree of trees) answers.push(['GET /api/spaces/:id/tree', tree]);
    if (trees.every((tree) => outcomeOf(tree) === 'ok')) {
      this.pages = trees.flatMap((tree) => pagesIn(tree.body, 'nodes'));
    }
    return answers;
  }

  /** @param {PageRef} page */
  async openPage(page) {
    const started = performance.now();
    const answer = await this.browser.send('GET', `/api/pages/${page.id}`);
    return this.#finish(STEPS.pageOpen, started, [['GET /api/pages/:id', answer]]);
  }

  /** Ctrl+K: a word from a page title, then half the time a result. */
  async search() {
    const words = this.pages.flatMap((page) => page.title.toLowerCase().match(/\p{L}{4,}/gu) ?? []);
    const text = pick(words) ?? pick(WORDS) ?? 'care';
    const started = performance.now();
    const answer = await this.browser.send('POST', '/api/search/query', { json: { text } });
    const done = this.#finish(STEPS.search, started, [['POST /api/search/query', answer]]);
    const result = pick(pagesIn(answer.body, 'results'));
    if (done && result && this.visit.features.pages && Math.random() < 0.5) {
      await this.openPage(result);
    }
    return done;
  }

  /**
   * Records a step: done when every answer in it was ok; otherwise the worst one counts.
   * @param {string} step
   * @param {number} started on the performance.now() clock
   * @param {[string, Answer][]} answers each with its route, like `GET /api/pages/:id`
   */
  #finish(step, started, answers) {
    const ms = performance.now() - started;
    const worst =
      answers.find(([, answer]) => outcomeOf(answer) === 'error') ??
      answers.find(([, answer]) => outcomeOf(answer) === 'failed');
    if (!worst) {
      this.visit.recorder.record(step, 'ok', ms);
      return true;
    }
    const [route, answer] = worst;
    this.visit.recorder.record(step, outcomeOf(answer), ms, problemOf(route, answer));
    return false;
  }
}
