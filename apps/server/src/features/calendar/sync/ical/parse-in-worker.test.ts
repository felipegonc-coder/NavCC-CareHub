import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IcalParseError, parseCalendar } from './parse';
import { MAX_PARSE_WORKERS, parseCalendarInWorker, workerFileFor } from './parse-in-worker';

// The worker runs as plain JavaScript, so it's built here the way build.mjs builds it.
let dir = '';
let workerFile = new URL('file:///');

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'carehub-parse-worker-'));
  const outfile = join(dir, 'calendar-parse-worker.js');
  await build({
    entryPoints: [fileURLToPath(new URL('./parse-worker.ts', import.meta.url))],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    logLevel: 'silent',
  });
  workerFile = pathToFileURL(outfile);
});

afterAll(() => rm(dir, { recursive: true, force: true }));

async function scriptWorker(name: string, source: string): Promise<URL> {
  const file = join(dir, name);
  await writeFile(file, source);
  return pathToFileURL(file);
}

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Example//Calendar//EN',
  'X-WR-CALNAME:Care Team Demo',
  'BEGIN:VEVENT',
  'UID:visit-1@example.com',
  'DTSTAMP:20261020T120000Z',
  'DTSTART;TZID=America/New_York:20261027T090000',
  'DTEND;TZID=America/New_York:20261027T100000',
  'RRULE:FREQ=WEEKLY;COUNT=4',
  'SUMMARY:Visit with Jordan Patel',
  'ATTENDEE;CN=Avery Lin:mailto:avery.lin@example.com',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

describe('parseCalendarInWorker', () => {
  it('reads a calendar in a worker, with the same result as in the server', async () => {
    const options = { now: new Date('2026-10-27T12:00:00Z') };
    const bytes = new TextEncoder().encode(ICS);
    expect(await parseCalendarInWorker(bytes, options, { workerFile })).toEqual(
      parseCalendar(bytes, options),
    );
  });

  it('passes on the reader errors with their code', async () => {
    const error = await parseCalendarInWorker('<!doctype html><p>Sign in</p>', {}, { workerFile })
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IcalParseError);
    expect((error as IcalParseError).code).toBe('not-calendar');
  });

  it('stops a calendar that takes too long', async () => {
    const nested = Array.from({ length: 200_000 }, (_, i) => `BEGIN:X-${i}`).join('\r\n');
    const error = await parseCalendarInWorker(
      `BEGIN:VCALENDAR\r\n${nested}`,
      {},
      {
        workerFile,
        timeoutMs: 5,
      },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IcalParseError);
    expect((error as IcalParseError).code).toBe('too-complex');
    expect((error as IcalParseError).message).toBe(
      "This calendar took too long to read, so it wasn't read.",
    );
  });

  it('stops a worker that runs out of memory', async () => {
    const greedy = await scriptWorker(
      'greedy.js',
      'const keep = []; for (;;) keep.push(new Array(1e6).fill(Math.random()));',
    );
    const error = await parseCalendarInWorker(ICS, {}, { workerFile: greedy }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(IcalParseError);
    expect((error as IcalParseError).code).toBe('too-complex');
  });

  it('reports a broken worker as an error of its own, not the calendar', async () => {
    const broken = await scriptWorker('broken.js', "throw new Error('Worker bug');");
    const error = await parseCalendarInWorker(ICS, {}, { workerFile: broken }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(IcalParseError);
  });
});

// A worker that counts, in shared memory passed as its input, how many workers run at once
// ([0] now, [1] most at once, [2] started in all), then answers after a while.
const COUNTING_WORKER = `
import { parentPort, workerData } from 'node:worker_threads';
const counts = new Int32Array(workerData.input.buffer);
const now = Atomics.add(counts, 0, 1) + 1;
Atomics.add(counts, 2, 1);
for (let most = Atomics.load(counts, 1); now > most; ) {
  const seen = Atomics.compareExchange(counts, 1, most, now);
  if (seen === most) break;
  most = seen;
}
setTimeout(() => {
  Atomics.sub(counts, 0, 1);
  const result = { events: [], calendar: {}, skipped: 0, truncated: false, warnings: [] };
  parentPort.postMessage({ ok: true, result });
}, 600);
`;

function counter() {
  const input = new Uint8Array(new SharedArrayBuffer(12));
  const counts = new Int32Array(input.buffer);
  return { input, mostAtOnce: () => counts[1], started: () => counts[2] };
}

describe('parseCalendarInWorker, several at once', () => {
  it('runs at most two workers at once, timing each from when it starts', async () => {
    const counting = await scriptWorker('counting.mjs', COUNTING_WORKER);
    const { input, mostAtOnce, started } = counter();
    // Each worker takes 600 ms. The third waits for one of the first two, so it would run out of
    // its 1000 ms if its time started when it was asked for.
    const reads = Array.from({ length: 3 }, () =>
      parseCalendarInWorker(input, {}, { workerFile: counting, timeoutMs: 1000 }),
    );
    const results = await Promise.all(reads);
    expect(results.map((r) => r.events)).toEqual([[], [], []]);
    expect(MAX_PARSE_WORKERS).toBe(2);
    expect(mostAtOnce()).toBe(2);
    expect(started()).toBe(3);
  });

  it('never starts a worker for a read cancelled while it waits', async () => {
    const counting = await scriptWorker('counting.mjs', COUNTING_WORKER);
    const { input, started } = counter();
    const first = [1, 2].map(() => parseCalendarInWorker(input, {}, { workerFile: counting }));
    const controller = new AbortController();
    const waiting = parseCalendarInWorker(
      input,
      {},
      { workerFile: counting, signal: controller.signal },
    ).catch((e: unknown) => e);
    const reason = new Error('The sync stopped.');
    controller.abort(reason);
    // It fails at once, without waiting for a place.
    const firstDone = Promise.race(first).then(() => 'a first read finished');
    expect(await Promise.race([waiting, firstDone])).toBe(reason);
    await Promise.all(first);
    expect(started()).toBe(2);
  });

  it('stops a running worker when its read is cancelled, and frees its place', async () => {
    // Counts in [0] every 10 ms, until it's stopped.
    const ticking = await scriptWorker(
      'ticking.mjs',
      `import { workerData } from 'node:worker_threads';
      const counts = new Int32Array(workerData.input.buffer);
      setInterval(() => Atomics.add(counts, 0, 1), 10);`,
    );
    const input = new Uint8Array(new SharedArrayBuffer(4));
    const ticks = () => new Int32Array(input.buffer)[0];
    const controllers = [new AbortController(), new AbortController()];
    const reads = controllers.map(({ signal }) =>
      parseCalendarInWorker(input, {}, { workerFile: ticking, signal }).catch((e: unknown) => e),
    );
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    while (ticks() === 0) await wait(10);
    const reason = new Error('The sync stopped.');
    for (const controller of controllers) controller.abort(reason);
    expect(await Promise.all(reads)).toEqual([reason, reason]);
    const stoppedAt = ticks();
    await wait(100);
    expect(ticks()).toBe(stoppedAt);
    // Both places are free again.
    const { events } = await parseCalendarInWorker(ICS, {}, { workerFile });
    expect(events).toHaveLength(1);
  });

  it('refuses a read whose signal is already cancelled', async () => {
    const reason = new Error('The sync stopped.');
    const error = await parseCalendarInWorker(
      ICS,
      {},
      { workerFile, signal: AbortSignal.abort(reason) },
    ).catch((e: unknown) => e);
    expect(error).toBe(reason);
  });
});

describe('workerFileFor', () => {
  it('uses the worker built next to the server bundle', () => {
    const file = workerFileFor('file:///app/apps/server/dist/index.js', () => true);
    expect(file.href).toBe('file:///app/apps/server/dist/calendar-parse-worker.js');
  });

  it('falls back to parse-worker.ts when running from source', () => {
    const checked: string[] = [];
    const file = workerFileFor('file:///repo/src/ical/parse-in-worker.ts', (bundled) => {
      checked.push(bundled.href);
      return false;
    });
    expect(file.href).toBe('file:///repo/src/ical/parse-worker.ts');
    expect(checked).toEqual(['file:///repo/src/ical/calendar-parse-worker.js']);
  });

  it('finds a worker file that exists in this repo', () => {
    const here = new URL('./parse-in-worker.ts', import.meta.url).href;
    expect(existsSync(workerFileFor(here))).toBe(true);
  });
});
