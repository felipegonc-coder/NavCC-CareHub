import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IcalParseError, parseCalendar } from './parse';
import { parseCalendarInWorker } from './parse-in-worker';

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
