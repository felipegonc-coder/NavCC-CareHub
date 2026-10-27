import { describe, expect, it } from 'vitest';
import { IMPORT_LIMITS, ImportFileError } from '../plan';
import { PlanWriter, shortName, TOO_MUCH_TEXT } from './plan-writer';

describe('PlanWriter', () => {
  it('makes keys unique within each kind', () => {
    const out = new PlanWriter('intake.json');
    expect([out.key('card'), out.key('card'), out.key('board')]).toEqual([
      'card-1',
      'card-2',
      'board-1',
    ]);
  });

  it('cuts text to its limit and lists the cut as a problem of the item', () => {
    const out = new PlanWriter('intake.json');
    expect(out.text('Call Rowan', 20, 'Card "Call Rowan"')).toBe('Call Rowan');
    expect(out.text('x'.repeat(30), 20, 'Card "xxx"')).toBe('x'.repeat(20));
    expect(out.cut('😀😀', 3, 'Label "😀😀"')).toBe('😀');
    expect(out.plan.problems).toEqual([
      {
        file: 'intake.json: Card "xxx"',
        what: 'Cut short',
        why: 'Only the first 20 characters were kept.',
      },
      {
        file: 'intake.json: Label "😀😀"',
        what: 'Cut short',
        why: 'Only the first 3 characters were kept.',
      },
    ]);
  });

  it('lists problems of the whole file and from other readers, cut to what a plan holds', () => {
    const out = new PlanWriter('notes.enex');
    out.problem(null, 'Left out', '2 encrypted sections stay in Evernote.');
    out.add([{ file: 'notes.enex: Note "Visit"', what: 'w'.repeat(300), why: 'Tables.' }]);
    expect(out.done().problems).toEqual([
      { file: 'notes.enex', what: 'Left out', why: '2 encrypted sections stay in Evernote.' },
      { file: 'notes.enex: Note "Visit"', what: 'w'.repeat(200), why: 'Tables.' },
    ]);
  });

  it('keeps 999 problems and counts the rest on the last line', () => {
    const out = new PlanWriter('board.json');
    for (let i = 0; i < 1_200; i += 1) out.problem(`Card ${i}`, 'Renamed', 'Commas.');
    const problems = out.done().problems;
    expect(problems).toHaveLength(IMPORT_LIMITS.problems);
    expect(problems[998]?.file).toBe('board.json: Card 998');
    expect(problems.at(-1)).toEqual({
      file: 'board.json',
      what: 'Not listed',
      why: '201 more problems like the ones above.',
    });
  });

  it('stops as soon as the plan passes the import text limit', () => {
    const out = new PlanWriter('big.json');
    out.spend(IMPORT_LIMITS.textChars);
    let error: unknown;
    try {
      out.text('one more', 100, 'Card');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ImportFileError);
    expect((error as Error).message).toBe(TOO_MUCH_TEXT);
  });

  it('names an item by the start of its text, on one line', () => {
    expect(shortName('  Call\n Rowan  ')).toBe('Call Rowan');
    expect(shortName('y'.repeat(80))).toBe(`${'y'.repeat(57)}...`);
  });
});
