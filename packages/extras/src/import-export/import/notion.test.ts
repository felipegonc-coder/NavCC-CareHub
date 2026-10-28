import { describe, expect, it } from 'vitest';
import {
  calloutsAsQuotes,
  cellText,
  notionId,
  notionImporter,
  notionLinkId,
  notionName,
  planNotion,
  rowPage,
} from './notion';
import { checkPlan, planLink, type ImportPlan } from './plan';

const id = (n: number) => String(n).repeat(32).slice(0, 32);
const home = `Clinic handbook ${id(1)}`;
const callbacks = `${home}/Callbacks ${id(2)}`;
const encoded = (path: string) => path.split('/').map(encodeURIComponent).join('/');

const entries = [
  {
    path: `${home}.md`,
    text: [
      '# Clinic handbook',
      '',
      `Start with [Intake](${encoded(`${home}/Intake ${id(3)}.md`)}).`,
      '',
      `[Callbacks](${encoded(`${callbacks}.csv`)})`,
      '',
      `![Desk](${encoded(`${home}/desk.png`)})`,
      '',
      '<aside>',
      '💡 Ask before you call.',
      '',
      '</aside>',
      `See [Call Rowan](https://www.notion.so/Call-Rowan-${id(4)}?pvs=21).`,
    ].join('\n'),
  },
  {
    path: `${home}/Intake ${id(3)}.md`,
    text: `# Intake\n\nBack to [the handbook](../${encoded(`${home}.md`)}).`,
  },
  {
    path: `${callbacks}.csv`,
    text: 'Name,Status,Assignee,Related\nCall Rowan,To do,Sam Ortiz,',
  },
  {
    path: `${callbacks}_all.csv`,
    text: [
      'Name,Status,Assignee,Related',
      `Call Rowan,To do,Sam Ortiz,Call Avery (${encoded(`Callbacks ${id(2)}/Call Avery ${id(5)}.md`)})`,
      'Call Avery,Done,,',
      'Call Jordan,Done,,',
    ].join('\n'),
  },
  {
    path: `${callbacks}/Call Rowan ${id(4)}.md`,
    text: `# Call Rowan\n\nStatus: To do\nAssignee: Sam Ortiz\n\nAsk about the [intake](../Intake%20${id(3)}.md).`,
  },
  { path: `${callbacks}/Call Avery ${id(5)}.md`, text: '# Call Avery\n\nStatus: Done\n' },
  {
    path: `${callbacks}/Call Kim ${id(6)}.md`,
    text: '# Call Kim\n\nStatus: Waiting\n\nLeft a message.',
  },
  { path: `${home}/desk.png` },
  { path: `${home}/old.pdf` },
  { path: '__MACOSX/._desk.png' },
];

/** The plan with keys swapped for titles, to compare. */
function shape(plan: ImportPlan) {
  const titles = new Map<string, string>();
  for (const page of plan.pages) titles.set(page.key, page.title);
  for (const database of plan.databases) {
    titles.set(database.key, database.title);
    for (const row of database.rows) titles.set(row.key, row.cells[0] ?? '');
  }
  for (const file of plan.files) titles.set(file.key, file.name);
  const named = (text: string) =>
    text.replace(/carehub-import:([A-Za-z0-9_-]+)/g, (_, key: string) => `<${titles.get(key)}>`);
  return {
    pages: plan.pages.map((page) => ({
      title: page.title,
      under: page.parent && titles.get(page.parent),
      text: 'markdown' in page.content ? named(page.content.markdown) : null,
    })),
    databases: plan.databases.map((database) => ({
      title: database.title,
      under: database.parent && titles.get(database.parent),
      columns: database.columns.map((column) => column.name),
      rows: database.rows.map((row) => ({
        cells: row.cells,
        text: row.content && 'markdown' in row.content ? named(row.content.markdown) : undefined,
      })),
    })),
    files: plan.files.map((file) => [file.name, file.entry]),
  };
}

describe('Notion export', () => {
  it('makes the page tree, the databases with their row pages, and the links between them', () => {
    const plan = planNotion(entries);
    expect(() => checkPlan(plan)).not.toThrow();
    expect(shape(plan)).toEqual({
      pages: [
        {
          title: 'Clinic handbook',
          under: null,
          text: [
            '',
            'Start with [Intake](<Intake>).',
            '',
            '[Callbacks](<Callbacks>)',
            '',
            '![Desk](<desk.png>)',
            '',
            '> 💡 Ask before you call.',
            '>',
            '',
            'See [Call Rowan](<Call Rowan>).',
          ].join('\n'),
        },
        {
          title: 'Intake',
          under: 'Clinic handbook',
          text: '\nBack to [the handbook](<Clinic handbook>).',
        },
      ],
      databases: [
        {
          title: 'Callbacks',
          under: 'Clinic handbook',
          columns: ['Name', 'Status', 'Assignee', 'Related'],
          rows: [
            {
              cells: ['Call Rowan', 'To do', 'Sam Ortiz', 'Call Avery'],
              text: '\nAsk about the [intake](<Intake>).',
            },
            { cells: ['Call Avery', 'Done', '', ''], text: undefined },
            { cells: ['Call Jordan', 'Done', '', ''], text: undefined },
            { cells: ['Call Kim', 'Waiting', '', ''], text: '\nLeft a message.' },
          ],
        },
      ],
      files: [['desk.png', `${home}/desk.png`]],
    });
    expect(plan.problems).toEqual([
      { file: `${home}/old.pdf`, what: 'Skipped', why: 'No page links to it.' },
    ]);
  });

  it('makes pages for folders without one, and refuses what it must', () => {
    const plan = planNotion([
      { path: `Team ${id(7)}/Shifts ${id(8)}.md`, text: 'Early and late.' },
      { path: '../outside.md', text: 'x' },
      { path: `Team ${id(7)}/tool.exe` },
    ]);
    expect(plan.pages.map((page) => [page.title, page.parent && planLink(page.parent)])).toEqual([
      ['Team', null],
      ['Shifts', planLink(plan.pages[0]?.key ?? '')],
    ]);
    expect(plan.problems.map((problem) => problem.what)).toEqual(['Skipped', 'Refused']);
  });

  it("says when the zip isn't an export, or holds the export in zips", () => {
    expect(() => planNotion([{ path: 'photo.png' }])).toThrow("this zip isn't a Notion export");
    expect(() => planNotion([{ path: 'Export-Part-1.zip' }])).toThrow('unzip it first');
  });

  it("reads rows' pages, cells and callouts as Notion writes them", () => {
    const columns = [
      { name: 'Name', type: null },
      { name: 'Status', type: null },
    ];
    expect(rowPage('# Call Kim\n\nStatus: Waiting\nNotes: none\n\nText', columns)).toEqual({
      title: 'Call Kim',
      text: '# Call Kim\n\nNotes: none\n\nText',
      values: new Map([['Status', 'Waiting']]),
    });
    expect(rowPage('No title\nStatus: Waiting', columns).title).toBeNull();
    expect(
      cellText(
        'Call Avery (Callbacks%201/Call%20Avery%202.md), Call Kim (https://www.notion.so/3)',
      ),
    ).toBe('Call Avery, Call Kim');
    expect(cellText('Rowan (front desk)')).toBe('Rowan (front desk)');
    expect(calloutsAsQuotes('<aside>💡 Quick one</aside>\nNext')).toBe('> 💡 Quick one\n\nNext');
    expect(calloutsAsQuotes('```\n<aside>\n```')).toBe('```\n<aside>\n```');
    expect(notionName(`Callbacks ${id(2)}`)).toBe('Callbacks');
    expect(notionName('Callbacks')).toBe('Callbacks');
    expect(notionId(`Callbacks ${'aB'.repeat(16)}`)).toBe('ab'.repeat(16));
    expect(notionId('Callbacks')).toBeUndefined();
    expect(notionLinkId(`https://www.notion.so/Call-Rowan-${id(4)}?pvs=21`)).toBe(id(4));
    expect(notionLinkId(`https://example.org/Call-Rowan-${id(4)}`)).toBeUndefined();
  });

  it('reads the text of pages and CSV files from the zip, and only those', async () => {
    const read: string[] = [];
    const plan = await notionImporter.plan({
      fileName: 'Export.zip',
      bytes: new Uint8Array(),
      text: async () => '',
      zip: {
        names: [`Intake ${id(3)}.md`, 'desk.png'],
        read: async () => new Uint8Array(),
        text: async (name) => {
          read.push(name);
          return '# Intake\n\n![Desk](desk.png)';
        },
      },
      options: {},
    });
    expect(read).toEqual([`Intake ${id(3)}.md`]);
    expect(plan.pages.map((page) => page.title)).toEqual(['Intake']);
    expect(plan.files.map((file) => file.entry)).toEqual(['desk.png']);
  });
});
