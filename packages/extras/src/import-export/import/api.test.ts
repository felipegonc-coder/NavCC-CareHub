import { describe, expect, it } from 'vitest';
import { planUploadSchema, startImportSchema, undoImportSchema } from './api';

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
});
