import {
  checkPlan,
  IMPORT_LIMITS,
  ImportFileError,
  type ImportInput,
  type ImportProblem,
  type PlanContent,
} from '@carehub/extras/import-export/import/plan';
import { describe, expect, it } from 'vitest';
import type { EnexNote } from './enex';
import { NOT_ENEX } from './enex';
import type { HtmlToContent } from '@carehub/extras/import-export/import/writer/html-reader';
import { evernoteImporter, evernotePlan, type Notebook } from './index';
import { enexFile, media, utf8 } from './testing';

/** A stand-in for the Import screen's HTML reader: the HTML as one paragraph, each address through link. */
function fakeReader(problems: ImportProblem[] = []) {
  const calls: { source: string; links: [string, string | null][] }[] = [];
  const read: HtmlToContent = (html, { source, link }) => {
    const links = Array.from(html.matchAll(/(?:href|src)="([^"]*)"/g), (match) => {
      const href = match[1] ?? '';
      return [href, link(href)] as [string, string | null];
    });
    calls.push({ source, links });
    const content: PlanContent = {
      doc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: html }] }],
      },
    };
    return { content, problems };
  };
  return { read, calls };
}

const scan = { bytes: utf8('fictional picture'), mime: 'image/png' };
const form = {
  bytes: utf8('fictional form'),
  mime: 'application/pdf',
  fileName: 'Intake form.pdf',
};

const note = (title: string, extra: Partial<EnexNote> = {}): EnexNote => ({
  title,
  created: '2026-03-03T14:15:00Z',
  updated: '2026-03-04T09:00:00Z',
  tags: [],
  enml: '<en-note><div>Text</div></en-note>',
  resources: [],
  ...extra,
});

function input(
  fileName: string,
  text: string,
  zip: ImportInput['zip'] = null,
  options: ImportInput['options'] = {},
): ImportInput {
  return { fileName, bytes: utf8(text), text: async () => text, zip, options };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('it did not throw');
}

describe('evernoteImporter', () => {
  it('makes a page for the notebook with each note under it, and its attachments files', async () => {
    const file = enexFile([
      {
        title: 'Intake call',
        body:
          `<div>${media(scan)}</div><div><a href="https://example.test/visit">Visit</a> ` +
          '<a href="evernote:///view/1/s1/abc/abc/">Forms note</a> ' +
          '<a href="javascript:alert(1)">x</a></div><en-crypt>U2Fs</en-crypt>',
        resources: [scan, form],
      },
      { title: '', body: `<div>See ${media({ bytes: utf8('gone'), mime: 'image/png' })}</div>` },
    ]);
    const reader = fakeReader();
    const plan = await evernoteImporter(reader.read).plan(input('Visits.enex', file));

    expect(
      plan.pages.map(({ key, parent, title, source }) => ({ key, parent, title, source })),
    ).toEqual([
      { key: 'notebook-1', parent: null, title: 'Visits', source: 'Visits.enex' },
      { key: 'note-1', parent: 'notebook-1', title: 'Intake call', source: 'Visits.enex' },
      { key: 'note-2', parent: 'notebook-1', title: 'Untitled', source: 'Visits.enex' },
    ]);
    const dates = { created: '2026-03-01T09:00:00Z', updated: '2026-03-02T10:00:00Z' };
    expect(plan.pages[1]).toMatchObject(dates);
    expect(plan.pages[0]?.created).toBeUndefined();
    expect(plan.files.map(({ key, name, bytes }) => ({ key, name, bytes }))).toEqual([
      { key: 'file-1', name: 'Attachment.png', bytes: scan.bytes },
      { key: 'file-2', name: 'Intake form.pdf', bytes: form.bytes },
    ]);
    expect(reader.calls[0]?.source).toBe('Visits.enex: Note "Intake call"');
    expect(reader.calls[0]?.links).toEqual([
      ['carehub-import:file-1', 'carehub-import:file-1'],
      ['https://example.test/visit', 'https://example.test/visit'],
      ['evernote:///view/1/s1/abc/abc/', null],
      ['javascript:alert(1)', null],
      ['carehub-import:file-2', 'carehub-import:file-2'],
    ]);
    expect(plan.problems).toEqual([
      { file: 'Visits.enex', what: 'Left out', why: "1 attachment isn't in the export." },
      {
        file: 'Visits.enex',
        what: 'Left out',
        why: '1 encrypted section: encrypted text can only be opened in Evernote.',
      },
      {
        file: 'Visits.enex',
        what: 'Kept as text',
        why: "1 link to another note. The export doesn't say which note a link opens.",
      },
    ]);
    expect(checkPlan(plan)).toHaveLength(3);
  });

  it('reads a zip of .enex files as one notebook each, in name order', async () => {
    const texts = new Map([
      ['Export/Visits.enex', enexFile([{ title: 'Intake', body: '' }])],
      ['Export/Forms.enex', enexFile([{ title: 'Consent', body: '' }])],
      ['Export/notes.txt', 'Not a notebook'],
    ]);
    const zip = {
      names: [...texts.keys()],
      read: async (name: string) => utf8(texts.get(name) ?? ''),
      text: async (name: string) => texts.get(name) ?? '',
    };
    const plan = await evernoteImporter(fakeReader().read).plan(input('Export.zip', '', zip));
    expect(plan.pages.map((page) => [page.title, page.parent])).toEqual([
      ['Forms', null],
      ['Consent', 'notebook-1'],
      ['Visits', null],
      ['Intake', 'notebook-2'],
    ]);

    const empty = { ...zip, names: ['Export/notes.txt'] };
    const error = await rejection(
      evernoteImporter(fakeReader().read).plan(input('a.zip', '', empty)),
    );
    expect(error).toBeInstanceOf(ImportFileError);
    expect(error.message).toBe(NOT_ENEX);
  });

  it('makes a database with the asDatabase option', async () => {
    const file = enexFile([{ title: 'Intake', body: '' }]);
    const options = { asDatabase: true };
    const plan = await evernoteImporter(fakeReader().read).plan(
      input('Visits.enex', file, null, options),
    );
    expect(plan.pages).toEqual([]);
    expect(plan.databases[0]?.rows[0]).toMatchObject({
      cells: ['Intake', '', '2026-03-01T09:00:00Z', '2026-03-02T10:00:00Z'],
      created: '2026-03-01T09:00:00Z',
      updated: '2026-03-02T10:00:00Z',
    });
  });

  it('passes on what the HTML reader could not bring in', async () => {
    const problem = { file: 'Visits.enex: Note "Intake"', what: 'Kept as text', why: 'A form.' };
    const plan = await evernoteImporter(fakeReader([problem]).read).plan(
      input('Visits.enex', enexFile([{ title: 'Intake', body: '' }])),
    );
    expect(plan.problems).toEqual([problem]);
  });
});

describe('evernotePlan as a database', () => {
  const notebooks: Notebook[] = [
    { name: 'Visits', notes: [note('Intake', { tags: ['Calls', 'Calls, urgent', 'Follow-up'] })] },
    { name: 'Forms', notes: [note('Consent', { created: null, updated: null })] },
  ];

  it('makes a row per note with its notebook, tags and dates', () => {
    const plan = evernotePlan(notebooks, 'Export.zip', fakeReader().read, { asDatabase: true });
    expect(plan.pages).toEqual([]);
    const [database] = plan.databases;
    expect(database?.title).toBe('Export');
    expect(database?.columns).toEqual([
      { name: 'Name', type: 'text' },
      { name: 'Notebook', type: 'select' },
      { name: 'Tags', type: 'multi_select' },
      { name: 'Created', type: 'date' },
      { name: 'Updated', type: 'date' },
    ]);
    expect(database?.rows.map((row) => [row.key, row.cells])).toEqual([
      [
        'note-1',
        [
          'Intake',
          'Visits',
          'Calls, Calls urgent, Follow-up',
          '2026-03-03T14:15:00Z',
          '2026-03-04T09:00:00Z',
        ],
      ],
      ['note-2', ['Consent', 'Forms', '', '', '']],
    ]);
    expect(database?.rows[0]?.content).toBeDefined();
    expect(plan.problems).toEqual([
      {
        file: 'Export.zip: Note "Intake"',
        what: 'Renamed',
        why: `Options can't have commas, so "Calls, urgent" is "Calls urgent".`,
      },
    ]);
    expect(checkPlan(plan)).toHaveLength(1);
  });

  it('leaves out the Notebook column for one notebook, and names the database after it', () => {
    const plan = evernotePlan(notebooks.slice(0, 1), 'Visits.enex', fakeReader().read, {
      asDatabase: true,
    });
    expect(plan.databases[0]?.title).toBe('Visits');
    expect(plan.databases[0]?.columns.map((column) => column.name)).toEqual([
      'Name',
      'Tags',
      'Created',
      'Updated',
    ]);
  });
});

describe('evernotePlan limits', () => {
  it('keeps the blocks that fit when a note is over a page', () => {
    const block = (n: number) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: `${n}`.repeat(400_000) }],
    });
    const big: HtmlToContent = () => ({
      content: { doc: { type: 'doc', content: [block(1), block(2), block(3)] } },
      problems: [],
    });
    const plan = evernotePlan([{ name: 'Visits', notes: [note('Long')] }], 'Visits.enex', big);
    const content = plan.pages[1]?.content;
    expect(content && 'doc' in content ? content.doc.content?.length : null).toBe(2);
    expect(plan.problems).toEqual([
      {
        file: 'Visits.enex: Note "Long"',
        what: 'Cut short',
        why: 'Only the first 1,000,000 characters were kept.',
      },
    ]);
  });

  it('stops before reading notes past the page or row limits', () => {
    const many = (count: number): Notebook[] => [
      { name: 'Visits', notes: Array.from({ length: count }, (_, i) => note(`Note ${i}`)) },
    ];
    const reader = fakeReader();
    const pages = (() => {
      try {
        evernotePlan(many(IMPORT_LIMITS.pages), 'Visits.enex', reader.read);
      } catch (error) {
        return error as Error;
      }
      return null;
    })();
    expect(pages?.message).toBe('imports can have up to 10,000 pages');
    const rows = (() => {
      try {
        evernotePlan(many(IMPORT_LIMITS.rows + 1), 'Visits.enex', reader.read, {
          asDatabase: true,
        });
      } catch (error) {
        return error as Error;
      }
      return null;
    })();
    expect(rows?.message).toBe('databases can have up to 20,000 rows');
    expect(reader.calls).toHaveLength(0);
  });
});
