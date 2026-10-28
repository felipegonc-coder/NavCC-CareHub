import { deflateRawSync } from 'node:zlib';
import { utf8, zipFile, type FixtureEntry } from '@carehub/databases/xlsx/fixtures';
import { describe, expect, it } from 'vitest';
import { openZip, readUpload, type ReadRequest } from './read';

const deflate = (data: Uint8Array) => new Uint8Array(deflateRawSync(data));
const zip = (entries: FixtureEntry[]) => zipFile(entries.map((entry) => ({ deflate, ...entry })));
const picture = (n: number) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, n]);

const request = (bytes: Uint8Array, change: Partial<ReadRequest> = {}): ReadRequest => ({
  source: 'markdown',
  fileName: 'handbook.zip',
  bytes,
  planned: false,
  ...change,
});

const titles = (pages: { title: string }[]) => pages.map((page) => page.title);

describe('readUpload', () => {
  it('reads a Markdown zip with its pictures (IE-01)', async () => {
    const { plan, files } = await readUpload(
      request(
        zip([
          { name: 'Intake guide.md', data: '# Intake guide\n\n![Desk](front-desk.png)\n' },
          { name: 'front-desk.png', data: picture(1) },
          { name: 'Escalations/Escalation steps.md', data: '![Tree](phone-tree.png)' },
          { name: 'Escalations/phone-tree.png', data: picture(2) },
        ]),
      ),
    );
    expect(titles(plan.pages)).toEqual(['Escalations', 'Escalation steps', 'Intake guide']);
    expect(plan.files.map((file) => file.name)).toEqual(['phone-tree.png', 'front-desk.png']);
    expect(files).toEqual([picture(2), picture(1)]);
    expect(plan.problems).toEqual([]);
  });

  it('reads one Markdown file', async () => {
    const { plan } = await readUpload(
      request(utf8('# Shift notes\n\nHello'), { fileName: 'notes.md' }),
    );
    expect(plan.pages.map((page) => [page.title, page.content])).toEqual([
      ['Shift notes', { markdown: '\nHello' }],
    ]);
  });

  it('leaves out programs, whatever they are called, and lists them', async () => {
    const { plan, files } = await readUpload(
      request(
        zip([
          { name: 'a.md', data: '![x](tool.png)' },
          { name: 'tool.png', data: Uint8Array.from([0x4d, 0x5a, 0x90, 0]) },
        ]),
      ),
    );
    expect(plan.files).toEqual([]);
    expect(files).toEqual([]);
    expect(plan.problems).toEqual([
      { file: 'tool.png', what: 'Refused', why: "Programs can't be imported." },
    ]);
  });

  it('leaves out Mac programs too', async () => {
    const macho = Uint8Array.from([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1]);
    const universal = Uint8Array.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2]);
    const { plan, files } = await readUpload(
      request(
        zip([
          { name: 'a.md', data: '![x](helper.png) ![y](fat.gif)' },
          { name: 'helper.png', data: macho },
          { name: 'fat.gif', data: universal },
        ]),
      ),
    );
    expect(files).toEqual([]);
    expect(plan.problems.map((problem) => [problem.file, problem.what]).sort()).toEqual([
      ['fat.gif', 'Refused'],
      ['helper.png', 'Refused'],
    ]);
  });

  it('stops with a reason the person can read', async () => {
    await expect(readUpload(request(utf8('not a zip')))).rejects.toThrow("the file isn't a zip");
    const damaged = zip([{ name: 'a.md', data: 'Hello', crc: 1 }]);
    await expect(readUpload(request(damaged))).rejects.toThrow('the zip is damaged');
    const locked = zip([{ name: 'a.md', data: 'Hello', flags: 1 }]);
    await expect(readUpload(request(locked))).rejects.toThrow('the zip has a password');
    await expect(readUpload(request(zip([{ name: 'a.png', data: picture(1) }])))).rejects.toThrow(
      'there are no Markdown or text files in it',
    );
    await expect(
      readUpload(request(utf8('{}'), { source: 'trello', fileName: 'board.json' })),
    ).rejects.toThrow("this kind of file can't be imported yet");
  });

  it('refuses entries packed too tightly (zip bombs)', () => {
    const bomb = zip([{ name: 'a.md', data: new Uint8Array(2 * 1024 * 1024) }]);
    expect(() => openZip(bomb)).toThrow('the zip is packed too tightly to open safely');
  });
});

describe('plans made by the Import screen', () => {
  const plan = {
    pages: [
      {
        key: 'p1',
        parent: null,
        title: 'Support',
        content: { doc: { type: 'doc', content: [] } },
        source: 'Support.html',
      },
    ],
    databases: [],
    files: [
      { key: 'f1', name: 'desk.png', entry: 'files/f1' },
      { key: 'f2', name: 'gone.png', entry: 'files/f2' },
    ],
    problems: [],
  };

  it('checks plan.json and reads the files it names', async () => {
    const upload = zip([
      { name: 'plan.json', data: JSON.stringify(plan) },
      { name: 'files/f1', data: picture(7) },
    ]);
    const { plan: read, files } = await readUpload(
      request(upload, { source: 'notion', fileName: 'Export.zip', planned: true }),
    );
    expect(titles(read.pages)).toEqual(['Support']);
    expect(read.files).toEqual([{ key: 'f1', name: 'desk.png' }]);
    expect(files).toEqual([picture(7)]);
    expect(read.problems).toEqual([
      { file: 'gone.png', what: 'Skipped', why: "It isn't in the zip." },
    ]);
  });

  it('refuses a plan that is missing or not one', async () => {
    const planned = (entries: FixtureEntry[]) =>
      readUpload(request(zip(entries), { source: 'html', fileName: 'a.html', planned: true }));
    await expect(planned([{ name: 'a.md', data: 'x' }])).rejects.toThrow('the import is damaged');
    await expect(planned([{ name: 'plan.json', data: '{' }])).rejects.toThrow('damaged');
    const script = { ...plan, pages: [{ ...plan.pages[0], content: { html: '<script>' } }] };
    await expect(planned([{ name: 'plan.json', data: JSON.stringify(script) }])).rejects.toThrow(
      'damaged',
    );
  });
});
