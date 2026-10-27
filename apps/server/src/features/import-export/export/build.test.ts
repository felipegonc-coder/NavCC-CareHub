import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import type { AccessLevel } from '@carehub/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../../db';
import { buildExport, planExport } from './build';
import type { ExportOptions } from './schema';
import { bindExportSources, type ExportPageInfo } from './sources';
import { readZip } from './testing';

// A fictional team space: Avery exports "Intake guide" with its sub-pages, a database of calls and
// a picture. Avery can't open "Payroll notes", and "Old draft" is in Trash (so never listed).
const db = {} as Db;
const avery = randomUUID();
const workspaceId = randomUUID();
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2]);

const ids = {
  guide: randomUUID(),
  steps: randomUUID(),
  payroll: randomUUID(),
  hidden: randomUUID(),
  calls: randomUUID(),
  rowan: randomUUID(),
  sky: randomUUID(),
  twin: randomUUID(),
  chart: randomUUID(),
  secretFile: randomUUID(),
  risky: randomUUID(),
  formula: randomUUID(),
};
const page = (
  id: string,
  title: string,
  parentId: string | null,
  kind: ExportPageInfo['kind'] = 'page',
): ExportPageInfo => ({ id, workspaceId, parentId, kind, title, icon: null });
const pages = [
  page(ids.guide, 'Intake guide', null),
  page(ids.steps, 'Escalation steps', ids.guide),
  page(ids.payroll, 'Payroll notes', ids.guide),
  page(ids.hidden, 'Under payroll', ids.payroll),
  page(ids.calls, 'Callbacks', ids.guide, 'database'),
  page(ids.rowan, 'Call Rowan', ids.calls, 'row'),
  page(ids.sky, 'Call Sky', ids.calls, 'row'),
  page(ids.twin, 'escalation steps', ids.guide),
  page(ids.risky, 'Risky: list', null, 'database'),
  page(ids.formula, '=HYPERLINK("x"), sure', ids.risky, 'row'),
];
const levels = new Map<string, AccessLevel>(pages.map((p) => [p.id, 'edit']));
levels.set(ids.payroll, 'none');

const text = (value: string, href?: string) => ({
  type: 'text',
  text: value,
  ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}),
});
const content = new Map<string, unknown>([
  [
    ids.guide,
    {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [text('Next: '), text('Escalation steps', `/p/${ids.steps}`)],
        },
        { type: 'image', attrs: { fileId: ids.chart, alt: 'Chart' } },
        { type: 'image', attrs: { fileId: ids.secretFile } },
        {
          type: 'paragraph',
          content: [{ type: 'mention', attrs: { kind: 'page', id: ids.payroll } }],
        },
        { type: 'subPage', attrs: { pageId: ids.calls } },
      ],
    },
  ],
  [
    ids.steps,
    {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [text('Intake guide', `/p/${ids.guide}`)] },
        { type: 'image', attrs: { fileId: ids.chart } },
      ],
    },
  ],
]);

const options = (more: Partial<ExportOptions> = {}): ExportOptions => ({
  includeSubpages: true,
  includeFiles: true,
  databases: 'all',
  origin: 'https://care.example.test',
  ...more,
});

let unbind: () => void;
beforeAll(() => {
  unbind = bindExportSources({
    pages: async (_db, wanted) =>
      new Map(pages.filter((p) => wanted.includes(p.id)).map((p) => [p.id, p])),
    subtree: async (_db, rootId) => {
      const under = (id: string): ExportPageInfo[] =>
        pages.filter((p) => p.parentId === id).flatMap((p) => [p, ...under(p.id)]);
      return under(rootId);
    },
    access: async (_db, userId, wanted) =>
      new Map(wanted.map((id) => [id, userId === avery ? (levels.get(id) ?? 'none') : 'none'])),
    content: async (_db, pageId) => content.get(pageId) ?? null,
    file: async (_db, { fileId }) =>
      fileId === ids.chart ? { name: 'chart.PNG', mimeType: 'image/png', data: PNG } : null,
    rowProperties: async (_db, { rowId }) =>
      rowId === ids.rowan ? [{ name: 'Status', value: 'Open' }] : [],
  });
});
afterAll(() => unbind());

async function exportOf(
  rootId: string,
  more: Partial<ExportOptions> = {},
  format = 'markdown' as const,
) {
  const root = pages.find((p) => p.id === rootId);
  if (!root) throw new Error('no root');
  const plan = await planExport(db, avery, root, options(more));
  const built = await buildExport(db, avery, plan, {
    format,
    options: options(more),
    maxBytes: 1_000_000,
  });
  return { plan, built, files: readZip(built.zip) };
}

/** The file a relative link in `from` leads to, as the browser test reads it. */
const target = (from: string, to: string) =>
  posix.normalize(posix.join(posix.dirname(from), decodeURIComponent(to.split('#')[0] ?? '')));
const linksIn = (markdown: string) =>
  [...markdown.matchAll(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g)].map(([, bang, label, to]) => ({
    picture: bang === '!',
    label,
    to: to ?? '',
  }));

describe('planExport', () => {
  it('takes the sub-pages they can open, counts the rest, and puts pages under their nearest exported parent', async () => {
    const root = pages[0] as ExportPageInfo;
    const plan = await planExport(db, avery, root, options());
    expect(plan.pages.map((p) => p.title)).toEqual([
      'Intake guide',
      'Escalation steps',
      'Under payroll',
      'Callbacks',
      'escalation steps',
      'Call Rowan',
      'Call Sky',
    ]);
    expect(plan.skipped).toBe(1);
    expect(plan.parentOf.get(ids.hidden)).toBe(ids.guide);
    expect(plan.parentOf.get(ids.rowan)).toBe(ids.calls);
  });

  it('takes only the page without sub-pages, but a database keeps its rows', async () => {
    const guide = await planExport(
      db,
      avery,
      pages[0] as ExportPageInfo,
      options({ includeSubpages: false }),
    );
    expect(guide.pages).toHaveLength(1);
    const calls = await planExport(
      db,
      avery,
      pages[4] as ExportPageInfo,
      options({ includeSubpages: false }),
    );
    expect(calls.pages.map((p) => p.title)).toEqual(['Callbacks', 'Call Rowan', 'Call Sky']);
  });

  it('gives someone who can open nothing below the root only the root', async () => {
    const plan = await planExport(db, randomUUID(), pages[0] as ExportPageInfo, options());
    expect(plan.pages).toHaveLength(1);
    expect(plan.skipped).toBe(7);
  });
});

describe('buildExport as Markdown', () => {
  it('writes each page as a .md file starting with its title, rows too, with a README for what was left out', async () => {
    const { files, built } = await exportOf(ids.guide);
    expect(built.fileName).toBe('Intake guide.zip');
    expect([...files.keys()].sort()).toEqual(
      [
        'README.md',
        'Intake guide.md',
        'Intake guide/Escalation steps.md',
        'Intake guide/Escalation steps/chart.png',
        'Intake guide/Under payroll.md',
        'Intake guide/Callbacks.csv',
        'Intake guide/escalation steps (2).md',
        'Intake guide/Callbacks/Call Rowan.md',
        'Intake guide/Callbacks/Call Sky.md',
        'Intake guide/chart.png',
      ].sort(),
    );
    expect(files.get('README.md')?.toString()).toContain(
      "1 page was left out because you can't open it",
    );
    expect(files.get('Intake guide/Callbacks/Call Rowan.md')?.toString()).toBe(
      '# Call Rowan\n\nStatus: Open\n',
    );
    expect(files.get('Intake guide/Callbacks.csv')?.toString()).toBe(
      'Name\r\nCall Rowan\r\nCall Sky\r\n',
    );
  });

  it('links pages, pictures and databases relatively, so every link works offline', async () => {
    const { files } = await exportOf(ids.guide);
    const guide = files.get('Intake guide.md')?.toString() ?? '';
    for (const [path, data] of files) {
      if (!path.endsWith('.md')) continue;
      for (const { to } of linksIn(data.toString())) {
        if (/^[a-z]+:/i.test(to)) continue;
        expect(files.has(target(path, to))).toBe(true);
      }
    }
    expect(linksIn(guide)).toEqual([
      { picture: false, label: 'Escalation steps', to: 'Intake%20guide/Escalation%20steps.md' },
      { picture: true, label: 'Chart', to: 'Intake%20guide/chart.png' },
      { picture: false, label: 'Callbacks', to: 'Intake%20guide/Callbacks.csv' },
    ]);
    // The picture it can't read and the page it can't open leave nothing to follow.
    expect(guide).toContain('*Picture not included*');
    expect(guide).toContain('No access');
    expect(guide).not.toContain('Payroll notes');
    const steps = files.get('Intake guide/Escalation steps.md')?.toString() ?? '';
    expect(linksIn(steps)[0]).toEqual({
      picture: false,
      label: 'Intake guide',
      to: '../Intake%20guide.md',
    });
    expect(files.get('Intake guide/Escalation steps/chart.png')).toEqual(PNG);
  });

  it('links pictures to Care Hub when files are left out', async () => {
    const { files } = await exportOf(ids.guide, { includeFiles: false, includeSubpages: false });
    expect([...files.keys()]).toEqual(['Intake guide.md']);
    expect(files.get('Intake guide.md')?.toString()).toContain(
      `](https://care.example.test/api/files/${ids.chart})`,
    );
    // Without sub-pages, a link to one goes to Care Hub.
    expect(files.get('Intake guide.md')?.toString()).toContain(
      `[Escalation steps](https://care.example.test/p/${ids.steps})`,
    );
  });

  it('quotes CSV cells, and cells a spreadsheet would run', async () => {
    const { files } = await exportOf(ids.risky);
    expect(files.get('Risky- list.csv')?.toString()).toBe(
      'Name\r\n"\'=HYPERLINK(""x""), sure"\r\n',
    );
    expect([...files.keys()]).toContain('Risky- list/=HYPERLINK(-x-), sure.md');
  });

  it('uses the database CSV when Databases gives one', async () => {
    const unbindCsv = bindExportSources({
      csv: async (_db, { databaseId }) =>
        databaseId === ids.calls ? 'Name,Status\r\nCall Rowan,Open\r\n' : null,
    });
    const { files } = await exportOf(ids.calls);
    unbindCsv();
    expect(files.get('Callbacks.csv')?.toString()).toBe('Name,Status\r\nCall Rowan,Open\r\n');
    expect([...files.keys()]).toContain('Callbacks/Call Sky.md');
  });

  it('refuses to grow past its limit', async () => {
    const root = pages[0] as ExportPageInfo;
    const plan = await planExport(db, avery, root, options());
    await expect(
      buildExport(db, avery, plan, { format: 'markdown', options: options(), maxBytes: 50 }),
    ).rejects.toThrow('over 50 bytes');
  });
});

describe('buildExport as HTML', () => {
  it('writes one .html file per page with relative links and no scripts', async () => {
    const { files } = await exportOf(ids.guide, {}, 'html' as never);
    const guide = files.get('Intake guide.html')?.toString() ?? '';
    expect(guide).toContain(
      '<a href="Intake%20guide/Escalation%20steps.html">Escalation steps</a>',
    );
    expect(guide).toContain('<img src="Intake%20guide/chart.png" alt="Chart">');
    expect(guide).toContain('<style>');
    expect(guide).not.toMatch(/<script/i);
    expect(files.has('Intake guide/Callbacks.csv')).toBe(true);
  });
});
