import { readZip, readZipEntry } from '@carehub/databases/xlsx';
import { zipFile } from '@carehub/databases/xlsx/fixtures';
import {
  ImportFileError,
  importSource,
  planUploadSchema,
  type ImportPlan,
  type ImportSource,
  type Importer,
} from '@carehub/extras/import-export/import/index';
import { describe, expect, it } from 'vitest';
import { TOO_BIG, fileProblem, prepareUpload, uploadName } from './prepare';

const source = (id: string): ImportSource => {
  const found = importSource(id);
  if (!found) throw new Error(id);
  return found;
};
const html = source('html');

function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** The upload's entries, by name. */
async function entries(blob: Blob): Promise<Map<string, Uint8Array>> {
  const read = readZip(await bytesOf(blob));
  if (!read.ok) throw new Error(read.problem);
  const out = new Map<string, Uint8Array>();
  for (const entry of read.zip.entries) {
    const bytes = readZipEntry(read.zip, entry, () => new Uint8Array(0));
    if (!bytes.ok) throw new Error(bytes.problem);
    out.set(entry.name, bytes.bytes);
  }
  return out;
}

const importer = (plan: (input: Parameters<Importer['plan']>[0]) => Promise<ImportPlan>) => ({
  html: { source: 'html' as const, plan },
});

const doc = { doc: { type: 'doc', content: [{ type: 'paragraph' }] } };

describe('getting a file ready to import', () => {
  it('says why a file is refused before anything is sent', () => {
    expect(fileProblem(source('evernote'), { name: 'Trip.txt', size: 10 })).toBe(
      'Pick a .enex file from Evernote, or a .zip of them.',
    );
    expect(fileProblem(html, { name: 'Trip.HTML', size: 100 * 1024 * 1024 + 1 })).toBe(TOO_BIG);
    expect(fileProblem(html, { name: 'Trip.html', size: 0 })).toBe('The file is empty.');
    expect(fileProblem(html, { name: 'Trip.html', size: 12 })).toBeNull();
  });

  it('keeps file names to 255 characters, with their ending', () => {
    expect(uploadName('  Trip notes.md ')).toBe('Trip notes.md');
    const long = uploadName(`${'a'.repeat(300)}.html`);
    expect(long).toHaveLength(255);
    expect(long.endsWith('a.html')).toBe(true);
    expect(uploadName(`${'a'.repeat(249)}🌊🌊🌊.zip`)).toBe(`${'a'.repeat(249)}🌊.zip`);
  });

  it("sends the file as it is when the screen doesn't read its source", async () => {
    const file = new File(['# Trip'], 'Trip.md');
    const upload = await prepareUpload(source('markdown'), file, { importers: {} });
    expect(upload.planned).toBe(false);
    expect(upload.body).toBe(file);
  });

  it('reads the file here and sends its plan, with the files it found', async () => {
    const picked = zipFile([
      { name: 'Trip/index.html', data: '<h1>Trip</h1>' },
      { name: 'Trip/beach.png', data: Uint8Array.of(137, 80, 78, 71) },
    ]);
    const seen: string[] = [];
    const importers = importer(async ({ fileName, zip, text }) => {
      seen.push(fileName, ...(zip?.names ?? []), (await text()).slice(0, 2));
      return {
        pages: [
          { key: 'p1', parent: null, title: 'Trip', content: doc, source: 'Trip/index.html' },
        ],
        databases: [
          {
            key: 'd1',
            parent: 'p1',
            title: 'Days',
            columns: [{ name: 'Day', type: null }],
            rows: [
              { key: 'r1', cells: ['Mon'] },
              { key: 'r2', cells: ['Tue'], content: { markdown: 'Rest' } },
            ],
            source: 'Trip/index.html',
          },
        ],
        files: [
          { key: 'f1', name: 'beach.png', entry: 'Trip/beach.png' },
          { key: 'f2', name: 'gone.png', entry: 'Trip/gone.png' },
          { key: 'f3', name: 'note.txt', bytes: new TextEncoder().encode('hi') },
        ],
        problems: [{ file: 'Trip/index.html', what: '1 table kept as text', why: 'Because.' }],
      };
    });
    const upload = await prepareUpload(html, new File([new Uint8Array(picked)], 'Trip.zip'), {
      importers,
    });
    expect(seen).toEqual(['Trip.zip', 'Trip/index.html', 'Trip/beach.png', 'PK']);
    expect(upload.planned).toBe(true);
    expect(upload.body.type).toBe('application/octet-stream');
    const inside = await entries(upload.body);
    expect([...inside.keys()]).toEqual(['plan.json', 'files/f1', 'files/f3']);
    expect(inside.get('files/f1')).toEqual(Uint8Array.of(137, 80, 78, 71));
    const plan: unknown = JSON.parse(new TextDecoder().decode(inside.get('plan.json')));
    expect(planUploadSchema.safeParse(plan).success).toBe(true);
    expect(plan).toMatchObject({
      files: [
        { key: 'f1', name: 'beach.png', entry: 'files/f1' },
        { key: 'f2', name: 'gone.png', entry: 'files/f2' },
        { key: 'f3', name: 'note.txt', entry: 'files/f3' },
      ],
      problems: [{ file: 'Trip/index.html', what: '1 table kept as text', why: 'Because.' }],
    });
  });

  it('gives the importer the options that were ticked', async () => {
    const seen: unknown[] = [];
    const importers = importer(async ({ options }) => {
      seen.push(options);
      return {
        pages: [{ key: 'p1', parent: null, title: 'Trip', content: doc, source: 'Trip.html' }],
        databases: [],
        files: [],
        problems: [],
      };
    });
    const file = new File(['<p>Trip</p>'], 'Trip.html');
    await prepareUpload(html, file, { importers });
    await prepareUpload(html, file, { importers, options: { asDatabase: true } });
    expect(seen).toEqual([{}, { asDatabase: true }]);
  });

  it('skips files over 50 MB and refuses plans the server would refuse', async () => {
    const big = new Uint8Array(50 * 1024 * 1024 + 1);
    const plan = (files: ImportPlan['files']): ImportPlan => ({
      pages: [{ key: 'p1', parent: null, title: 'Trip', content: doc, source: 'Trip.html' }],
      databases: [],
      files,
      problems: [],
    });
    const file = new File(['<p>Trip</p>'], 'Trip.html');
    const one = importer(async () => plan([{ key: 'f1', name: 'film.mov', bytes: big }]));
    const inside = await entries((await prepareUpload(html, file, { importers: one })).body);
    expect(JSON.parse(new TextDecoder().decode(inside.get('plan.json')))).toMatchObject({
      files: [],
      problems: [{ file: 'film.mov', what: 'Skipped', why: 'Files inside can be up to 50 MB.' }],
    });

    const many = Array.from({ length: 1_000 }, (_, i) => ({
      key: `f${i}`,
      name: `${i}.png`,
      bytes: Uint8Array.of(i % 256),
    }));
    const tooMany = importer(async () => plan(many));
    await expect(prepareUpload(html, file, { importers: tooMany })).rejects.toThrow(
      'it has more than 999 files',
    );
    const twice = importer(async () => ({
      ...plan([]),
      pages: [...plan([]).pages, ...plan([]).pages],
    }));
    await expect(prepareUpload(html, file, { importers: twice })).rejects.toThrow(
      'the import is damaged',
    );
    const unreadable = importer(async () => {
      throw new ImportFileError("the page isn't HTML");
    });
    await expect(prepareUpload(html, file, { importers: unreadable })).rejects.toThrow(
      "the page isn't HTML",
    );
    const notZip = new File(['<p>Trip</p>'], 'Trip.zip');
    await expect(prepareUpload(html, notZip, { importers: one })).rejects.toThrow(
      "the file isn't a zip",
    );
  });
});
