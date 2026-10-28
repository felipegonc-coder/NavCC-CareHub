import { describe, expect, it } from 'vitest';
import { importOptionsSchema, planUploadSchema, startImportSchema, undoImportSchema } from './api';
import { IMPORT_OPTION_IDS } from './sources';

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
  databases: [
    {
      key: 'd1',
      parent: 'p1',
      title: 'Callbacks',
      columns: [
        { name: 'Name', type: null },
        { name: 'Calls', type: 'number' },
      ],
      rows: [{ key: 'r1', cells: ['Call Rowan', '2'], content: { markdown: 'Rowan' } }],
      source: 'Callbacks.html',
    },
  ],
  files: [{ key: 'f1', name: 'desk.png', entry: 'files/f1' }],
  problems: [{ file: 'Callbacks.html', what: 'Total', why: 'Formulas come in as their values.' }],
};

describe('import requests', () => {
  it('takes a start request', () => {
    expect(
      startImportSchema.parse({
        source: 'markdown',
        fileName: ' notes.zip ',
        size: 10,
        pageId: null,
      }),
    ).toEqual({
      source: 'markdown',
      fileName: 'notes.zip',
      size: 10,
      pageId: null,
      planned: false,
    });
    expect(
      startImportSchema.safeParse({ source: 'x', fileName: 'a', size: 1, pageId: null }).success,
    ).toBe(false);
    expect(
      startImportSchema.safeParse({
        source: 'markdown',
        fileName: 'a.md',
        size: 101 * 1024 * 1024,
        pageId: null,
      }).success,
    ).toBe(false);
    expect(undoImportSchema.parse({})).toEqual({ removeChanged: false });
  });

  it('takes the options the person ticked, and only known ones', () => {
    const start = { source: 'trello', fileName: 'board.json', size: 10, pageId: null };
    expect(startImportSchema.parse({ ...start, options: { includeArchived: true } })).toEqual({
      ...start,
      planned: false,
      options: { includeArchived: true },
    });
    const takes = (options: unknown) => startImportSchema.safeParse({ ...start, options }).success;
    expect(takes({ archived: true })).toBe(false);
    expect(takes({ includeArchived: 'yes' })).toBe(false);
    expect(Object.keys(importOptionsSchema.shape)).toEqual([...IMPORT_OPTION_IDS]);
  });

  it('takes a plan from the Import screen and nothing else', () => {
    expect(planUploadSchema.parse(plan)).toEqual(plan);
    const bad = (change: (copy: typeof plan) => void) => {
      const copy = JSON.parse(JSON.stringify(plan)) as typeof plan;
      change(copy);
      return planUploadSchema.safeParse(copy).success;
    };
    expect(bad((copy) => (copy.pages[0]!.key = '../x'))).toBe(false);
    expect(bad((copy) => (copy.pages[0]!.content = { doc: { type: 'paragraph' } } as never))).toBe(
      false,
    );
    expect(bad((copy) => (copy.databases[0]!.columns[1]!.type = 'formula' as never))).toBe(false);
    expect(bad((copy) => ((copy.files[0] as Record<string, unknown>).bytes = 'AAAA'))).toBe(false);
    expect(bad((copy) => (copy.pages[0]!.title = 'x'.repeat(501)))).toBe(false);
  });

  it('takes dates, people, relations and a board view', () => {
    const rich = {
      ...plan,
      pages: [{ ...plan.pages[0]!, created: '2021-03-03T10:15:00Z', updated: '2021-03-04' }],
      databases: [
        {
          ...plan.databases[0]!,
          columns: [
            { name: 'Name', type: null },
            { name: 'Status', type: 'status' },
            { name: 'Assignee', type: 'person' },
            { name: 'Parent task', type: 'relation' },
          ],
          rows: [{ key: 'r1', cells: ['Call Rowan', 'To do', 'avery@example.test', ''] }],
          view: { layout: 'board', groupBy: 'Status' },
        },
      ],
    };
    expect(planUploadSchema.parse(rich)).toEqual(rich);
    const takes = (change: Record<string, unknown>) =>
      planUploadSchema.safeParse({ ...rich, pages: [{ ...rich.pages[0], ...change }] }).success;
    expect(takes({ created: '2021-03-03T10:15:00+01:00', updated: '2021-03-03T10:15' })).toBe(true);
    expect(takes({ created: 'March 3, 2021' })).toBe(false);
    expect(takes({ updated: '2021-13-03' })).toBe(false);
    const view = (value: unknown) =>
      planUploadSchema.safeParse({ ...rich, databases: [{ ...rich.databases[0], view: value }] })
        .success;
    expect(view({ layout: 'calendar', groupBy: 'Status' })).toBe(false);
    expect(view({ layout: 'board' })).toBe(false);
  });
});
