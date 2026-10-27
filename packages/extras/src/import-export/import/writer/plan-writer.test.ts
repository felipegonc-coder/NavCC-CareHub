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

  it('cuts text to its limit and lists the cut as a problem of the file', () => {
    const out = new PlanWriter('intake.json');
    expect(out.text('Call Rowan', 20, 'Card "Call Rowan"')).toBe('Call Rowan');
    expect(out.text('x'.repeat(30), 20, 'Card "xxx"')).toBe('x'.repeat(20));
    expect(out.cut('😀😀', 3, 'Label "😀😀"')).toBe('😀');
    expect(out.plan.problems).toEqual([
      { file: 'intake.json', what: 'Card "xxx"', why: 'It was cut to 20 characters.' },
      { file: 'intake.json', what: 'Label "😀😀"', why: 'It was cut to 3 characters.' },
    ]);
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
