import {
  checkPlan,
  planLink,
  type ImportPlan,
  type PlanContent,
  type PlanNode,
} from '@carehub/extras/import-export/import/index';
import { describe, expect, it } from 'vitest';
import { notionHtmlImporter, planNotionHtml } from './notion-importer';

const id = (n: number) => String(n).repeat(32).slice(0, 32);
const href = (path: string) => path.split('/').map(encodeURIComponent).join('/');
const home = `Clinic handbook ${id(1)}`;
const callbacks = `${home}/Callbacks ${id(2)}`;

const icon = (type: string) =>
  `<span class="icon property-icon"><svg viewBox="0 0 16 16" class="types${type}"></svg></span>`;
const th = (type: string, name: string) => `<th>${icon(type)}${name}</th>`;
const select = (value: string) =>
  `<span class="selected-value select-value-color-blue">${value}</span>`;
const property = (kind: string, name: string, value: string) =>
  `<tr class="property-row property-row-${kind}"><th>${name}</th><td>${value}</td></tr>`;
const titleCell = (to: string, title: string) =>
  `<td class="cell-title"><a href="${href(to)}">${title}</a></td>`;

/** A page as Notion's HTML export writes it. */
const notionPage = (title: string, body: string, properties = '') =>
  `<html><head><title>${title}</title></head><body><article class="page sans"><header>` +
  `<h1 class="page-title">${title}</h1><table class="properties"><tbody>${properties}</tbody>` +
  `</table></header><div class="page-body">${body}</div></article></body></html>`;

const entries = [
  {
    path: `${home}.html`,
    text: notionPage(
      'Clinic handbook',
      `<p>Start with <a href="${href(`Clinic handbook ${id(1)}/Intake ${id(3)}.html`)}">Intake</a>.</p>` +
        `<figure class="link-to-page"><a href="${href(`Clinic handbook ${id(1)}/Callbacks ${id(2)}.html`)}"><span class="icon">📋</span>Callbacks</a></figure>` +
        `<figure class="image"><a href="${href(`${home}/desk.png`)}"><img src="${href(`${home}/desk.png`)}"/></a></figure>` +
        `<p>See <a href="https://www.notion.so/Call-Kim-${id(4)}">Call Kim</a>.</p>` +
        '<figure class="equation"><span class="katex"><annotation>a^2</annotation></span></figure>' +
        '<div class="collection-content"><h4 class="collection-title">Shifts</h4>' +
        `<table class="collection-content"><thead><tr>${th('Title', 'Name')}${th('Date', 'Day')}</tr></thead>` +
        `<tbody><tr>${titleCell(`${home}/Shifts ${id(5)}/Early ${id(6)}.html`, 'Early')}<td><time>@October 30, 2026</time></td></tr></tbody></table></div>`,
    ),
  },
  {
    path: `${home}/Intake ${id(3)}.html`,
    text: notionPage(
      'Intake',
      `<p>Back to <a href="${href(`../${home}.html`)}">the handbook</a>.</p>`,
    ),
  },
  {
    path: `${callbacks}.html`,
    text: notionPage(
      'Callbacks',
      `<table class="collection-content"><thead><tr>${th('Select', 'Status')}${th('Title', 'Name')}` +
        `${th('Person', 'Owner')}${th('Checkbox', 'Done')}${th('Formula', 'Days open')}${th('MultipleSelect', 'Tags')}</tr></thead><tbody>` +
        `<tr><td>${select('Waiting')}</td>${titleCell(`Callbacks ${id(2)}/Call Kim ${id(4)}.html`, 'Call Kim')}` +
        `<td><span class="user"><span class="icon user-icon">S</span>Sam Ortiz</span></td>` +
        `<td><div class="checkbox checkbox-on"></div></td><td>3</td><td>${select('Urgent')}${select('Phone')}</td></tr>` +
        `<tr><td>${select('Done')}</td>${titleCell(`Callbacks ${id(2)}/Call Avery ${id(7)}.html`, 'Call Avery')}` +
        '<td></td><td><div class="checkbox checkbox-off"></div></td><td>0</td><td></td></tr>' +
        '</tbody></table><br/><br/>',
    ),
  },
  {
    path: `${callbacks}/Call Kim ${id(4)}.html`,
    text: notionPage(
      'Call Kim',
      `<p>Called twice. Back to <a href="${href(`../Callbacks ${id(2)}.html`)}">Callbacks</a>.</p>`,
      property('select', 'Status', select('Waiting')) +
        property('phone_number', 'Phone', '555-0100'),
    ),
  },
  { path: `${callbacks}/Call Avery ${id(7)}.html`, text: notionPage('Call Avery', '') },
  {
    path: `${callbacks}/Call Rowan ${id(8)}.html`,
    text: notionPage(
      'Call Rowan',
      '<p>Left a message.</p>',
      property('select', 'Status', select('Waiting')) +
        property('phone_number', 'Phone', '555-0101'),
    ),
  },
  {
    path: `${home}/Shifts ${id(5)}/Early ${id(6)}.html`,
    text: notionPage('Early', '<p>Opens at 7.</p>'),
  },
  {
    path: `Dashboard ${id(9)}.html`,
    text: notionPage(
      'Dashboard',
      '<div class="collection-content"><h4 class="collection-title">Open callbacks</h4>' +
        `<table class="collection-content"><thead><tr>${th('Title', 'Name')}</tr></thead><tbody>` +
        `<tr>${titleCell(`${callbacks}/Call Kim ${id(4)}.html`, 'Call Kim')}</tr></tbody></table></div>`,
    ),
  },
  { path: `${home}/desk.png` },
  { path: `${home}/notes.txt` },
  { path: 'tool.exe' },
];

/** The text of a page, with each link's address after it in brackets. */
function textOf(content: PlanContent | undefined): string {
  const walk = (node: PlanNode): string => {
    const link = node.marks?.find((mark) => mark.type === 'link')?.attrs?.href;
    const own = node.text === undefined ? '' : link ? `${node.text}[${String(link)}]` : node.text;
    return own + (node.content ?? []).map(walk).join(node.type === 'doc' ? '\n' : '');
  };
  return content && 'doc' in content ? walk(content.doc) : '';
}

const planOf = (): ImportPlan => {
  const plan = planNotionHtml(entries);
  checkPlan(plan);
  return plan;
};

describe("Notion's HTML export", () => {
  it('makes the page tree, the databases with their row pages, and the links between them', () => {
    const plan = planOf();
    const page = (title: string) => plan.pages.find((one) => one.title === title);
    const database = (title: string) => plan.databases.find((one) => one.title === title);
    const keyOf = (title: string) => page(title)?.key ?? database(title)?.key ?? '';
    const callbacksDb = database('Callbacks');
    const row = (title: string) => callbacksDb?.rows.find((one) => one.cells[0] === title);
    const link = (key: string | undefined) => planLink(key ?? '');

    expect(plan.pages.map(({ title, parent }) => [title, parent])).toEqual([
      ['Clinic handbook', null],
      ['Intake', keyOf('Clinic handbook')],
      ['Dashboard', null],
    ]);
    expect(plan.databases.map(({ title, parent }) => [title, parent])).toEqual([
      ['Callbacks', keyOf('Clinic handbook')],
      ['Shifts', keyOf('Clinic handbook')],
    ]);
    expect(callbacksDb?.columns).toEqual([
      { name: 'Name', type: null },
      { name: 'Status', type: 'select' },
      { name: 'Owner', type: 'person' },
      { name: 'Done', type: 'checkbox' },
      { name: 'Days open', type: 'text' },
      { name: 'Tags', type: 'multi_select' },
      { name: 'Phone', type: 'phone' },
    ]);
    expect(callbacksDb?.rows.map((one) => one.cells)).toEqual([
      ['Call Kim', 'Waiting', 'Sam Ortiz', 'Yes', '3', 'Urgent, Phone', '555-0100'],
      ['Call Avery', 'Done', '', 'No', '0', '', ''],
      ['Call Rowan', 'Waiting', '', '', '', '', '555-0101'],
    ]);
    expect(row('Call Avery')?.content).toBeUndefined();
    expect(textOf(row('Call Rowan')?.content)).toBe('Left a message.');
    expect(textOf(row('Call Kim')?.content)).toBe(
      `Called twice. Back to Callbacks[${link(callbacksDb?.key)}].`,
    );
    const shifts = database('Shifts');
    expect(shifts?.columns).toEqual([
      { name: 'Name', type: null },
      { name: 'Day', type: 'date' },
    ]);
    expect(shifts?.rows.map((one) => [one.cells, textOf(one.content)])).toEqual([
      [['Early', 'October 30, 2026'], 'Opens at 7.'],
    ]);

    const desk = plan.files.find((file) => file.name === 'desk.png');
    expect(plan.files).toEqual([{ key: desk?.key, name: 'desk.png', entry: `${home}/desk.png` }]);
    expect(textOf(page('Clinic handbook')?.content).split('\n')).toEqual([
      `Start with Intake[${link(keyOf('Intake'))}].`,
      `Callbacks[${link(callbacksDb?.key)}]`,
      `desk.png[${link(desk?.key)}]`,
      `See Call Kim[${link(row('Call Kim')?.key)}].`,
      'a^2',
      `Shifts[${link(shifts?.key)}]`,
    ]);
    expect(textOf(page('Intake')?.content)).toBe(
      `Back to the handbook[${link(keyOf('Clinic handbook'))}].`,
    );
    // A table of rows already read is a view of their database.
    expect(textOf(page('Dashboard')?.content)).toBe(`Open callbacks[${link(callbacksDb?.key)}]`);
  });

  it('lists formulas, equations and what it leaves out', () => {
    expect(planOf().problems).toEqual([
      { file: 'tool.exe', what: 'Refused', why: "Programs can't be imported." },
      {
        file: `${callbacks}.html`,
        what: 'Formula "Days open" kept as text',
        why: 'It came in as text, with its last values.',
      },
      {
        file: `${home}.html`,
        what: '1 picture kept as a link',
        why: "Pages can't show pictures yet.",
      },
      { file: `${home}.html`, what: '1 equation kept as text', why: "Pages can't show them yet." },
      { file: `${home}/notes.txt`, what: 'Skipped', why: 'No page links to it.' },
    ]);
  });

  it("says when the zip isn't an export, or holds the export in zips", () => {
    expect(() => planNotionHtml([{ path: 'photo.png' }])).toThrow("this zip isn't a Notion export");
    expect(() => planNotionHtml([{ path: 'Export-Part-1.zip' }])).toThrow('unzip it first');
  });

  it('reads the text of the pages in the zip, and only those', async () => {
    const read: string[] = [];
    const plan = await notionHtmlImporter.plan({
      fileName: 'Export.zip',
      bytes: new Uint8Array(),
      text: async () => '',
      zip: {
        names: [`Intake ${id(3)}.html`, 'desk.png', '__MACOSX/._Intake.html'],
        read: async () => new Uint8Array(),
        text: async (name) => {
          read.push(name);
          return notionPage('Intake', '<img src="desk.png">');
        },
      },
      options: {},
    });
    expect(read).toEqual([`Intake ${id(3)}.html`]);
    expect(plan.pages.map((page) => page.title)).toEqual(['Intake']);
    expect(plan.files.map((file) => file.entry)).toEqual(['desk.png']);
    await expect(
      notionHtmlImporter.plan({
        fileName: 'Intake.html',
        bytes: new Uint8Array(),
        text: async () => '',
        zip: null,
        options: {},
      }),
    ).rejects.toThrow("this zip isn't a Notion export");
  });
});
