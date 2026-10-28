import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { decodeCsvBytes } from '../csv/decode';
import { utf8, zipFile, type FixtureEntry } from './fixtures';
import { crc32, readZip, readZipEntry, ZIP_LIMITS, type InflateRaw, type ZipArchive } from './zip';

const inflate: InflateRaw = (b, max) => inflateRawSync(b, { maxOutputLength: max });
const deflate = (b: Uint8Array): Uint8Array => deflateRawSync(b);
const text = (b: Uint8Array): string => decodeCsvBytes(b);

function open(bytes: Uint8Array): ZipArchive {
  const r = readZip(bytes);
  if (!r.ok) throw new Error(`readZip refused: ${r.problem}`);
  return r.zip;
}

/** The text of one entry, or its problem. */
function readText(zip: ZipArchive, name: string, inflater: InflateRaw = inflate): string {
  const entry = zip.entries.find((e) => e.name === name);
  if (!entry) throw new Error(`no entry ${name}`);
  const r = readZipEntry(zip, entry, inflater);
  return r.ok ? text(r.bytes) : `problem: ${r.problem}`;
}

const problemOf = (entries: FixtureEntry[]) => {
  const r = readZip(zipFile(entries));
  return r.ok ? 'ok' : r.problem;
};

const REVIEWS = 'Name,Score\r\nAvery Lin,9\r\nJordan Park,8\r\n'.repeat(50);

describe('crc32', () => {
  it('gives the standard check values', () => {
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926);
    expect(crc32(utf8('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('readZip and readZipEntry', () => {
  it('lists entries in central directory order and reads stored and deflated ones', () => {
    const zip = open(
      zipFile([
        { name: 'notes.txt', data: 'Blue Pine Plumbing' },
        { name: 'xl/reviews.csv', data: REVIEWS, deflate },
      ]),
    );
    expect(zip.entries.map((e) => [e.name, e.method, e.size])).toEqual([
      ['notes.txt', 0, 18],
      ['xl/reviews.csv', 8, REVIEWS.length],
    ]);
    expect(zip.entries[1]?.compressedSize).toBeLessThan(REVIEWS.length);
    expect(readText(zip, 'notes.txt')).toBe('Blue Pine Plumbing');
    expect(readText(zip, 'xl/reviews.csv')).toBe(REVIEWS);
  });

  it('inflates with the declared size as the limit', () => {
    const zip = open(zipFile([{ name: 'a.csv', data: REVIEWS, deflate }]));
    const spy = vi.fn(inflate);
    expect(readText(zip, 'a.csv', spy)).toBe(REVIEWS);
    expect(spy.mock.calls[0]?.[1]).toBe(REVIEWS.length);
  });

  it('reads entries whose sizes come after the data (data descriptor)', () => {
    const zip = open(
      zipFile([
        { name: 'a.txt', data: 'Avery Lin', dataDescriptor: true },
        { name: 'b.csv', data: REVIEWS, deflate, dataDescriptor: true },
      ]),
    );
    expect(readText(zip, 'a.txt')).toBe('Avery Lin');
    expect(readText(zip, 'b.csv')).toBe(REVIEWS);
  });

  it('reads UTF-8 names and turns backslashes into slashes', () => {
    const zip = open(
      zipFile([
        { name: 'Résumé – Jordan.txt', data: 'x' },
        { name: 'xl\\worksheets\\sheet1.xml', data: '<worksheet/>' },
      ]),
    );
    expect(zip.entries.map((e) => e.name)).toEqual([
      'Résumé – Jordan.txt',
      'xl/worksheets/sheet1.xml',
    ]);
  });

  it("doesn't call the inflater for an empty entry", () => {
    const zip = open(zipFile([{ name: 'empty.xml', data: '', deflate }]));
    const spy = vi.fn(inflate);
    expect(readText(zip, 'empty.xml', spy)).toBe('');
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it('reads a zip with no entries', () => {
    expect(open(zipFile([])).entries).toEqual([]);
  });
});

describe('readZip refuses before inflating', () => {
  it('files that are not zips', () => {
    expect(readZip(utf8('Name,Score\r\nAvery Lin,9\r\n'))).toEqual({
      ok: false,
      problem: 'not_zip',
    });
    expect(readZip(new Uint8Array(0))).toEqual({ ok: false, problem: 'not_zip' });
  });

  it('zips without an end record, or cut short', () => {
    const bytes = zipFile([{ name: 'a.txt', data: 'Avery Lin' }]);
    expect(readZip(bytes.subarray(0, bytes.length - 5))).toEqual({ ok: false, problem: 'damaged' });
    expect(readZip(utf8(`PK${' '.repeat(40)}`))).toEqual({ ok: false, problem: 'damaged' });
  });

  it('a central directory outside the file or with a bad record', () => {
    const bytes = zipFile([{ name: 'a.txt', data: 'Avery Lin' }]);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const moved = bytes.slice();
    new DataView(moved.buffer).setUint32(bytes.length - 6, bytes.length, true);
    expect(readZip(moved)).toEqual({ ok: false, problem: 'damaged' });
    const broken = bytes.slice();
    broken[view.getUint32(bytes.length - 6, true)] = 0;
    expect(readZip(broken)).toEqual({ ok: false, problem: 'damaged' });
  });

  it('encrypted entries (flag bit 0, strong encryption, AES)', () => {
    expect(problemOf([{ name: 'a.xml', data: 'x', flags: 1 }])).toBe('encrypted');
    expect(problemOf([{ name: 'a.xml', data: 'x', flags: 0x41 }])).toBe('encrypted');
    expect(problemOf([{ name: 'a.xml', data: 'x', method: 99 }])).toBe('encrypted');
  });

  it('more than 1,000 entries', () => {
    const entries = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `p${i}.xml`, data: 'x' }));
    expect(problemOf(entries(ZIP_LIMITS.entries))).toBe('ok');
    expect(problemOf(entries(ZIP_LIMITS.entries + 1))).toBe('too_many_entries');
  });

  it('an entry over 50 MB once unpacked', () => {
    const big = ZIP_LIMITS.entryBytes;
    expect(problemOf([{ name: 'a.xml', data: 'x', deflate, size: big }])).toBe('ok');
    expect(problemOf([{ name: 'a.xml', data: 'x', deflate, size: big + 1 }])).toBe('entry_too_big');
  });

  it('more than 100 MB in all once unpacked', () => {
    const half = ZIP_LIMITS.totalBytes / 2;
    const entry = (name: string, size: number) => ({ name, data: 'x', deflate, size });
    expect(problemOf([entry('a.xml', half), entry('b.xml', half)])).toBe('ok');
    expect(problemOf([entry('a.xml', half), entry('b.xml', half), entry('c.xml', 1)])).toBe(
      'too_big',
    );
  });

  it('ZIP64 markers and split archives', () => {
    expect(problemOf([{ name: 'a.xml', data: 'x', size: 0xffffffff }])).toBe('unsupported');
    const bytes = zipFile([{ name: 'a.txt', data: 'Avery Lin' }]);
    const split = bytes.slice();
    new DataView(split.buffer).setUint16(bytes.length - 18, 1, true);
    expect(readZip(split)).toEqual({ ok: false, problem: 'unsupported' });
  });
});

describe('readZip refuses as damaged, so that every zip reader sees the same files', () => {
  it('names that repeat, ignoring case', () => {
    const twice = (a: string, b: string) =>
      problemOf([
        { name: a, data: 'Avery Lin' },
        { name: b, data: 'Jordan Park' },
      ]);
    expect(twice('xl/workbook.xml', 'XL/Workbook.xml')).toBe('damaged');
    expect(twice('xl\\workbook.xml', 'xl/workbook.xml')).toBe('damaged');
    expect(twice('xl/workbook.xml', 'xl/workbook.xml.rels')).toBe('ok');
  });

  it('local headers that disagree with the central directory', () => {
    const entry = { name: 'xl/a.xml', data: REVIEWS };
    expect(problemOf([{ ...entry, local: { name: 'xl/b.xml' } }])).toBe('damaged');
    expect(problemOf([{ ...entry, local: { method: 8 } }])).toBe('damaged');
    expect(problemOf([{ ...entry, local: { crc: 1 } }])).toBe('damaged');
    expect(problemOf([{ ...entry, local: { size: 3 } }])).toBe('damaged');
    // With a data descriptor, the local header has no CRC-32 or sizes to compare.
    expect(problemOf([{ ...entry, dataDescriptor: true }])).toBe('ok');
    expect(problemOf([{ ...entry, dataDescriptor: true, local: { name: 'xl/b.xml' } }])).toBe(
      'damaged',
    );
  });

  it('entries that share bytes with each other or the central directory', () => {
    const a = { name: 'xl/a.xml', data: 'Avery Lin' };
    const b = { name: 'xl/b.xml', data: 'Jordan Park' };
    expect(problemOf([a, b, { ...b, name: 'xl/c.xml', centralOnly: true, offset: 0 }])).toBe(
      'damaged',
    );
    // b's local header and data, hidden inside a's data.
    const hidden = zipFile([b]).subarray(0, 30 + 8 + 11);
    expect(problemOf([{ ...a, data: hidden }])).toBe('ok');
    expect(
      problemOf([
        { ...a, data: hidden },
        { ...b, centralOnly: true, offset: 30 + 8 },
      ]),
    ).toBe('damaged');
    expect(problemOf([a, { ...b, compressedSize: 12 }])).toBe('damaged');
  });

  it('also when reading an entry', () => {
    const zip = open(zipFile([{ name: 'xl/a.xml', data: 'Avery Lin' }]));
    const entry = zip.entries[0];
    if (!entry) throw new Error('no entry');
    expect(readZipEntry(zip, { ...entry, name: 'xl/b.xml' }, inflate)).toEqual({
      ok: false,
      problem: 'damaged',
    });
    expect(readZipEntry(zip, { ...entry, method: 8 }, inflate)).toEqual({
      ok: false,
      problem: 'damaged',
    });
  });
});

describe('readZipEntry checks what it unpacks', () => {
  const entryProblem = (entry: FixtureEntry, inflater: InflateRaw = inflate) => {
    const zip = open(zipFile([entry]));
    return readText(zip, entry.name, inflater);
  };

  it('a CRC-32 that does not match', () => {
    expect(entryProblem({ name: 'a.txt', data: 'Avery Lin', crc: 1 })).toBe('problem: damaged');
    expect(entryProblem({ name: 'b.csv', data: REVIEWS, deflate, crc: 1 })).toBe(
      'problem: damaged',
    );
  });

  it('data that unpacks to more or less than declared', () => {
    expect(entryProblem({ name: 'a.csv', data: REVIEWS, deflate, size: 100 })).toBe(
      'problem: damaged',
    );
    expect(entryProblem({ name: 'a.csv', data: REVIEWS, deflate, size: REVIEWS.length + 1 })).toBe(
      'problem: damaged',
    );
    const greedy: InflateRaw = (b, max) => new Uint8Array(max + 1);
    expect(entryProblem({ name: 'a.csv', data: REVIEWS, deflate }, greedy)).toBe(
      'problem: damaged',
    );
  });

  it('deflate data the inflater rejects', () => {
    const garbage = () => Uint8Array.from([0xff, 0xff, 0xff, 0xff]);
    expect(entryProblem({ name: 'a.csv', data: REVIEWS, deflate: garbage })).toBe(
      'problem: damaged',
    );
  });

  it('a stored entry whose sizes differ', () => {
    expect(entryProblem({ name: 'a.txt', data: 'Avery Lin', size: 4 })).toBe('problem: damaged');
  });

  it('compression other than stored and deflate', () => {
    expect(entryProblem({ name: 'a.txt', data: 'Avery Lin', method: 12 })).toBe(
      'problem: unsupported',
    );
  });

  it('a local header that is missing or cut short', () => {
    const bytes = zipFile([{ name: 'a.txt', data: 'Avery Lin' }]);
    const zip = open(bytes);
    const entry = zip.entries[0];
    if (!entry) throw new Error('no entry');
    const broken = { bytes: bytes.slice(), entries: zip.entries };
    broken.bytes[0] = 0;
    expect(readZipEntry(broken, entry, inflate)).toEqual({ ok: false, problem: 'damaged' });
    const longer = { ...entry, compressedSize: bytes.length };
    expect(readZipEntry(zip, longer, inflate)).toEqual({ ok: false, problem: 'damaged' });
    const outside = { ...entry, headerOffset: bytes.length - 10 };
    expect(readZipEntry(zip, outside, inflate)).toEqual({ ok: false, problem: 'damaged' });
  });
});
