import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Person,
  STEPS,
  filesIn,
  pagesIn,
  spaceIdsIn,
  type Features,
} from '../../../scripts/load/person.mjs';
import { main, parseOptions, prepare } from '../../../scripts/load/run.mjs';
import { PAGE_OPEN, Recorder } from '../../../scripts/load/stats.mjs';
import { startFakeCareHub, type FakeCareHub } from './fake-care-hub.js';

// Made up for each run, so no password is written here.
const password = randomUUID();
const env = { LOAD_PASSWORD: password };
const account = { email: 'eli.editor@example.test', password };
const all: Features = { signIn: true, spaces: true, tree: true, pages: true, search: true };

let fake: FakeCareHub | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
  vi.restoreAllMocks();
});

describe('parseOptions', () => {
  it('has defaults for everything but the password', () => {
    expect(parseOptions([], env)).toEqual({
      url: 'http://127.0.0.1:3000',
      accounts: [
        'avery.admin@example.test',
        'eli.editor@example.test',
        'casey.commenter@example.test',
        'val.viewer@example.test',
      ],
      password,
      people: 30,
      duration: 60,
      ramp: 15,
      pause: 2000,
      budget: 1000,
      report: null,
    });
    expect(
      parseOptions(['--people', '5', '--url', 'https://carehub.example.test'], env),
    ).toMatchObject({
      people: 5,
      url: 'https://carehub.example.test',
    });
    expect(parseOptions(['--help'], {})).toBeNull();
  });

  it('refuses real accounts, a missing password and numbers out of range', () => {
    expect(() => parseOptions(['--accounts', 'someone@carehub.org'], env)).toThrow(
      '--accounts takes only fictional test accounts, ending in @example.test.',
    );
    expect(() => parseOptions([], {})).toThrow('Set LOAD_PASSWORD');
    expect(() => parseOptions(['--people', '0'], env)).toThrow(
      '--people must be a whole number from 1 to 200, not "0".',
    );
    expect(() => parseOptions(['--url', 'ftp://example.test'], env)).toThrow('--url must be');
    expect(() => parseOptions(['--unknown'], env)).toThrow();
  });
});

describe('what the person reads from the answers', () => {
  it('finds the files a page loads, the spaces and the pages', () => {
    const html =
      '<script src="/a.js"></script><link rel="stylesheet" href="/a.css"><link href="//cdn.example/x.css"><script src="/a.js"></script>';
    expect(filesIn(html)).toEqual(['/a.js', '/a.css']);
    expect(
      spaceIdsIn({
        spaces: [{ id: 'a' }, { id: 'b', archivedAt: '2026-10-01' }],
        privateSpaceId: 'c',
      }),
    ).toEqual(['a', 'c']);
    expect(spaceIdsIn(null)).toEqual([]);
    const nodes = [
      { id: 'p', kind: 'page', title: 'Shift notes' },
      { id: 'd', kind: 'database', title: 'Rows' },
    ];
    expect(pagesIn({ nodes }, 'nodes')).toEqual([{ id: 'p', title: 'Shift notes' }]);
    expect(pagesIn({ results: 'nope' }, 'results')).toEqual([]);
  });
});

describe('prepare', () => {
  it('finds every feature and adds fictional pages up to ten', async () => {
    fake = await startFakeCareHub({ password, pages: 3 });
    const options = parseOptions(['--url', fake.url], env);
    const recorder = new Recorder();
    expect(await prepare(options!, recorder)).toEqual({ version: 'fake-1', features: all });
    expect(fake.created).toHaveLength(7);
    expect(fake.created[0]).toMatch(/\(load test 4\)$/);
    expect(recorder.skipped()).toEqual([]);
    expect(fake.requests.at(-1)).toBe('POST /api/auth/sign-out');
  });

  it('skips what the build does not have yet', async () => {
    fake = await startFakeCareHub({ password, missing: ['GET /api/spaces/:id/tree'] });
    const recorder = new Recorder();
    const { features } = await prepare(parseOptions(['--url', fake.url], env)!, recorder);
    expect(features).toEqual({ ...all, tree: false, pages: false });
    expect(recorder.skipped()).toEqual([
      { step: PAGE_OPEN, reason: 'needs the sidebar tree (GET /api/spaces/:id/tree)' },
    ]);
  });

  it('runs only the first visit before sign-in exists', async () => {
    fake = await startFakeCareHub({ password, missing: ['POST /api/auth/sign-in'] });
    const recorder = new Recorder();
    const { features } = await prepare(parseOptions(['--url', fake.url], env)!, recorder);
    expect(features.signIn).toBe(false);
    expect(recorder.skipped().map((entry) => entry.step)).toEqual([
      STEPS.signIn,
      STEPS.appStart,
      STEPS.sidebar,
      PAGE_OPEN,
      STEPS.search,
    ]);
  });

  it('stops when the server fails while it gets ready', async () => {
    fake = await startFakeCareHub({ password, failing: ['GET /api/spaces'] });
    await expect(prepare(parseOptions(['--url', fake.url], env)!, new Recorder())).rejects.toThrow(
      'GET /api/spaces answered 500 while the test was getting ready.',
    );
    expect(fake.requests.at(-1)).toBe('POST /api/auth/sign-out');
  });

  it('stops with a reason when the password is wrong', async () => {
    fake = await startFakeCareHub({ password: randomUUID() });
    await expect(prepare(parseOptions(['--url', fake.url], env)!, new Recorder())).rejects.toThrow(
      "Couldn't sign in as avery.admin@example.test: it answered 401.",
    );
  });
});

describe('Person', () => {
  it('visits, signs in, then opens pages, searches and uses the sidebar until the end', async () => {
    fake = await startFakeCareHub({ password, pages: 5 });
    const recorder = new Recorder();
    const person = new Person({
      baseUrl: fake.url,
      account,
      features: all,
      recorder,
      endsAt: performance.now() + 400,
      pauseMs: 20,
    });
    await person.run();
    for (const roll of [0.1, 0.7, 0.9, 0.95]) await person.act(roll);
    const steps = new Map(recorder.summary().map((step) => [step.step, step]));
    for (const step of Object.values(STEPS)) {
      expect(steps.get(step), step).toMatchObject({ failed: 0, errors: 0 });
      expect(steps.get(step)?.done, step).toBeGreaterThan(0);
    }
    expect(person.files.map((file) => file.path)).toEqual([
      '/theme-init.js',
      '/favicon.svg',
      '/assets/app.css',
      '/assets/app.js',
    ]);
    expect(person.pages).toHaveLength(5);
  });

  it('records server errors with their route', async () => {
    fake = await startFakeCareHub({ password, failing: ['GET /api/pages/:id'] });
    const recorder = new Recorder();
    const person = new Person({
      baseUrl: fake.url,
      account,
      features: all,
      recorder,
      endsAt: 0,
      pauseMs: 20,
    });
    await person.run();
    await person.act(0.1);
    expect(recorder.problems()).toEqual([
      { problem: 'page open: GET /api/pages/:id answered 500', count: 1 },
    ]);
  });
});

describe('main', () => {
  it('runs, writes the report and exits 0 within the budget', async () => {
    fake = await startFakeCareHub({ password });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const args = [
      '--url',
      fake.url,
      '--people',
      '3',
      '--duration',
      '1',
      '--ramp',
      '0',
      '--pause',
      '100',
    ];
    expect(await main(args, env)).toBe(0);
    expect(log.mock.calls[0]?.[0]).toContain('**Passed:** page open p95 is');
  });

  it('exits 2 when it cannot run', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['--people', 'many'], env)).toBe(2);
    fake = await startFakeCareHub({ password });
    const { url } = fake;
    await fake.close();
    fake = undefined;
    expect(await main(['--url', url], env)).toBe(2);
    expect(error.mock.calls[1]?.[0]).toContain("didn't answer /api/health (ECONNREFUSED)");
  });
});
