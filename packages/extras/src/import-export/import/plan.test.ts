import { describe, expect, it } from 'vitest';
import {
  IMPORT_LIMITS,
  ImportFileError,
  checkPlan,
  clip,
  planLink,
  planTextSize,
  resolvePlanLinks,
  stoppedMessage,
  type ImportPlan,
  type PlanDatabase,
  type PlanPage,
} from './plan';

const page = (key: string, parent: string | null = null, markdown = ''): PlanPage => ({
  key,
  parent,
  title: `Page ${key}`,
  content: { markdown },
  source: `${key}.md`,
});

const database = (key: string, parent: string | null, rows: string[]): PlanDatabase => ({
  key,
  parent,
  title: `Database ${key}`,
  columns: [{ name: 'Name', type: null }],
  rows: rows.map((row) => ({ key: row, cells: [`Row ${row}`] })),
  source: `${key}.csv`,
});

const plan = (parts: Partial<ImportPlan>): ImportPlan => ({
  pages: [],
  databases: [],
  files: [],
  problems: [],
  ...parts,
});

const keysOf = (items: ReturnType<typeof checkPlan>) =>
  items.map((item) => (item.kind === 'page' ? item.page.key : item.database.key));

describe('checkPlan', () => {
  it('orders every parent before what is under it, across pages, databases and rows', () => {
    const items = checkPlan(
      plan({
        pages: [page('s', 'r1'), page('a'), page('b', 'a')],
        databases: [database('d', 'a', ['r1', 'r2'])],
      }),
    );
    expect(keysOf(items)).toEqual(['a', 'b', 'd', 's']);
  });

  it('refuses unknown parents, files as parents and repeated keys', () => {
    const damaged = new ImportFileError('the import is damaged');
    expect(() => checkPlan(plan({ pages: [page('a', 'nope')] }))).toThrow(damaged.message);
    expect(() =>
      checkPlan(
        plan({ pages: [page('a', 'f')], files: [{ key: 'f', name: 'x.png', entry: 'x' }] }),
      ),
    ).toThrow('damaged');
    expect(() => checkPlan(plan({ pages: [page('a'), page('a')] }))).toThrow('damaged');
    expect(() => checkPlan(plan({ pages: [page('a b')] }))).toThrow('damaged');
  });

  it('refuses loops and pages nested too deep', () => {
    expect(() => checkPlan(plan({ pages: [page('a', 'b'), page('b', 'a')] }))).toThrow(
      'up to 64 levels',
    );
    const deep = Array.from({ length: 66 }, (_, n) => page(`p${n}`, n === 0 ? null : `p${n - 1}`));
    expect(() => checkPlan(plan({ pages: deep }))).toThrow('up to 64 levels');
    expect(checkPlan(plan({ pages: deep.slice(0, 65) }))).toHaveLength(65);
  });

  it('refuses plans past the limits', () => {
    const many = Array.from({ length: IMPORT_LIMITS.pages + 1 }, (_, n) => page(`p${n}`));
    expect(() => checkPlan(plan({ pages: many }))).toThrow('up to 10,000 pages');
    const text = 'x'.repeat(IMPORT_LIMITS.textChars);
    expect(() => checkPlan(plan({ pages: [page('a', null, text)] }))).toThrow('10 MB of text');
    const wide = database('d', null, []);
    wide.columns = Array.from({ length: 201 }, (_, n) => ({ name: `C${n}`, type: null }));
    expect(() => checkPlan(plan({ databases: [wide] }))).toThrow('200 columns');
  });
});

describe('plan links', () => {
  it('swaps known keys and keeps the others', () => {
    const text = `[a](${planLink('p1')}) ![b](${planLink('f1')}) [c](${planLink('gone')})`;
    const resolved = resolvePlanLinks(text, (key) =>
      key === 'p1' ? '/p/1' : key === 'f1' ? '/files/1' : null,
    );
    expect(resolved).toBe('[a](/p/1) ![b](/files/1) [c](carehub-import:gone)');
  });
});

describe('sizes and messages', () => {
  it('counts titles, text, cells and names', () => {
    const counted = plan({
      pages: [page('a', null, 'Hello')],
      databases: [database('d', null, ['r'])],
      files: [{ key: 'f', name: 'a.png', entry: 'a.png' }],
    });
    expect(planTextSize(counted)).toBe('Page a'.length + 5 + 'Database d'.length + 4 + 5 + 5);
  });

  it('never cuts a surrogate pair in half', () => {
    expect(clip('ab😀cd', 3)).toBe('ab');
    expect(clip('abc', 5)).toBe('abc');
  });

  it('says why the import stopped and that nothing was added', () => {
    expect(stoppedMessage('the zip is damaged')).toBe(
      'The import stopped: the zip is damaged. Nothing was added.',
    );
  });
});
