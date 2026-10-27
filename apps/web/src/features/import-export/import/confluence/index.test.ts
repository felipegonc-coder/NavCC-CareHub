import {
  checkPlan,
  ImportFileError,
  type ImportInput,
  type ImportProblem,
  type PlanContent,
} from '@carehub/extras/import-export/import/plan';
import type { HtmlToContent } from '@carehub/extras/import-export/import/writer/html-reader';
import { describe, expect, it } from 'vitest';
import { confluenceImporter, confluencePlan, NOT_CONFLUENCE } from './index';
import { indexHtml, pageHtml, zipOf } from './testing';

/** A stand-in for the Import screen's HTML reader: it keeps the HTML and each address's link. */
function fakeReader(problems: ImportProblem[] = []) {
  const calls: { source: string; html: string; links: [string, string | null][] }[] = [];
  const read: HtmlToContent = (html, { source, link }) => {
    const links = Array.from(html.matchAll(/(?:href|src)="([^"]*)"/g), (match) => {
      const href = match[1] ?? '';
      return [href, link(href)] as [string, string | null];
    });
    calls.push({ source, html, links });
    const content: PlanContent = {
      doc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
      },
    };
    return { content, problems };
  };
  return { read, calls };
}

const SPACE = 'Care Team';
// A fictional space: a home page with Intake and Forms under it, a page only its breadcrumbs
// place, and two pages whose breadcrumbs point at each other.
const space = {
  'CARE/index.html': indexHtml(SPACE, [
    [
      'Care-Team-Home_1.html',
      'Care Team Home',
      [['Intake_2.html', 'Intake', [['Forms_3.html', 'Forms']]]],
    ],
  ]),
  'CARE/Care-Team-Home_1.html': pageHtml(SPACE, 'Care Team Home', '<p>Welcome.</p>'),
  'CARE/Intake_2.html': pageHtml(
    SPACE,
    'Intake',
    '<p>See <a href="Forms_3.html#Forms-Top">Forms</a>, <a href="attachments/2/10.pdf">the form</a>, ' +
      '<a href="https://example.test/visit">the visit</a>, <a href="Discharge_99.html">Discharge</a> ' +
      'and <a href="javascript:alert(1)">x</a>.</p><p><img src="attachments/2/11.png?width=200"></p>' +
      '<div class="conf-macro" data-macro-name="jira">' +
      '<a href="https://jira.example.test/browse/CARE-1">CARE-1</a></div>',
    {
      crumbs: [['Care-Team-Home_1.html', 'Care Team Home']],
      attachments: [
        ['attachments/2/10.pdf', 'Intake form.pdf'],
        ['attachments/2/11.png', 'scan.png'],
        ['attachments/2/12.txt', 'notes.txt'],
      ],
    },
  ),
  'CARE/Forms_3.html': pageHtml(SPACE, 'Forms', '<p>Forms.</p>'),
  'CARE/Visit notes_4.html': pageHtml(SPACE, 'Visit notes', '<p>Notes.</p>', {
    crumbs: [['Intake_2.html', 'Intake']],
  }),
  'CARE/A_5.html': pageHtml(SPACE, 'A', '<p>A</p>', { crumbs: [['B_6.html', 'B']] }),
  'CARE/B_6.html': pageHtml(SPACE, 'B', '<p>B</p>', { crumbs: [['A_5.html', 'A']] }),
  'CARE/attachments/2/10.pdf': 'fictional form',
  'CARE/attachments/2/11.png': 'fictional picture',
  'CARE/attachments/2/12.txt': 'fictional notes',
  'CARE/attachments/2/13.html': '<p>An attached page</p>',
  'CARE/images/icons/bullet_blue.gif': 'icon',
  'CARE/styles/site.css': 'body {}',
};

const input = (fileName: string, zip: ImportInput['zip']): ImportInput => ({
  fileName,
  bytes: new Uint8Array(),
  text: () => Promise.resolve(''),
  zip,
  options: {},
});

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('it did not throw');
}

describe('confluencePlan', () => {
  it("makes the space's page tree, with its files, links and macros (IE-06)", async () => {
    const reader = fakeReader();
    const plan = await confluencePlan(zipOf(space), 'CARE.zip', reader.read);
    expect(
      plan.pages.map(({ key, parent, title, source }) => [key, parent, title, source]),
    ).toEqual([
      ['space-1', null, 'Care Team', 'CARE/index.html'],
      ['page-1', 'space-1', 'Care Team Home', 'CARE/Care-Team-Home_1.html'],
      ['page-2', 'page-1', 'Intake', 'CARE/Intake_2.html'],
      ['page-3', 'page-2', 'Forms', 'CARE/Forms_3.html'],
      ['page-4', 'space-1', 'A', 'CARE/A_5.html'],
      ['page-5', 'page-4', 'B', 'CARE/B_6.html'],
      ['page-6', 'page-2', 'Visit notes', 'CARE/Visit notes_4.html'],
    ]);
    expect(plan.files).toEqual([
      { key: 'file-1', name: 'notes.txt', entry: 'CARE/attachments/2/12.txt' },
      { key: 'file-2', name: 'Intake form.pdf', entry: 'CARE/attachments/2/10.pdf' },
      { key: 'file-3', name: 'scan.png', entry: 'CARE/attachments/2/11.png' },
    ]);
    const intake = reader.calls[1];
    expect(intake?.source).toBe('CARE.zip: Page "Intake"');
    expect(intake?.links).toEqual([
      ['Forms_3.html#Forms-Top', 'carehub-import:page-3'],
      ['attachments/2/10.pdf', 'carehub-import:file-2'],
      ['https://example.test/visit', 'https://example.test/visit'],
      ['Discharge_99.html', null],
      ['javascript:alert(1)', null],
      ['attachments/2/11.png?width=200', 'carehub-import:file-3'],
      ['https://jira.example.test/browse/CARE-1', 'https://jira.example.test/browse/CARE-1'],
      ['carehub-import:file-1', 'carehub-import:file-1'],
    ]);
    expect(intake?.html).toContain('<h2>Attachments</h2><ul><li><a href="carehub-import:file-1">');
    expect(intake?.html).not.toContain('Available Pages');
    expect(plan.problems).toEqual([
      { file: 'CARE.zip', what: 'Kept as text', why: '1 jira macro came in as text.' },
      {
        file: 'CARE.zip',
        what: 'Kept as text',
        why: "1 link goes to pages or files that aren't in the export.",
      },
    ]);
    expect(checkPlan(plan)).toHaveLength(7);
  });

  it('passes on what the HTML reader could not bring in', async () => {
    const problem = { file: 'CARE.zip: Page "Forms"', what: 'Left out', why: 'A video.' };
    const one = {
      'CARE/index.html': space['CARE/index.html'],
      'CARE/Forms_3.html': space['CARE/Forms_3.html'],
    };
    const plan = await confluencePlan(zipOf(one), 'CARE.zip', fakeReader([problem]).read);
    expect(plan.problems).toEqual([problem]);
    expect(plan.pages.map((page) => page.parent)).toEqual([null, 'space-1']);
  });

  it("stops when the zip isn't a Confluence space, or has more pages than an import holds", async () => {
    const reader = fakeReader().read;
    const notSpaces: Record<string, string>[] = [{ 'notes.txt': 'Hi' }, { 'a.html': '<p>Hi</p>' }];
    for (const entries of notSpaces) {
      const error = await rejection(confluencePlan(zipOf(entries), 'a.zip', reader));
      expect(error).toBeInstanceOf(ImportFileError);
      expect(error.message).toBe(NOT_CONFLUENCE);
    }
    const error = await rejection(confluenceImporter(reader).plan(input('a.zip', null)));
    expect(error.message).toBe(NOT_CONFLUENCE);

    const names = Array.from({ length: 10_000 }, (_, i) => `CARE/Page_${i}.html`);
    const big = {
      names,
      read: () => Promise.reject(new Error('read')),
      text: () => Promise.reject(new Error('read')),
    };
    const tooMany = await rejection(confluencePlan(big, 'CARE.zip', reader));
    expect(tooMany.message).toBe('imports can have up to 10,000 pages');
  });

  it('reads the zip it is given', async () => {
    const reader = fakeReader();
    const plan = await confluenceImporter(reader.read).plan(input('CARE.zip', zipOf(space)));
    expect(plan.pages).toHaveLength(7);
  });
});
