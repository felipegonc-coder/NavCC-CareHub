import { describe, expect, it } from 'vitest';
import { groupUpdates, updatePerson, updateText, type UpdateEntry } from './index';

const sam = { id: 'u-sam', name: 'Sam Ortiz' };
const avery = { id: 'u-avery', name: 'Avery Lin' };
const TZ = 'America/Denver';
const now = new Date('2026-10-27T22:00:00Z');
let next = 0;
const entry = (at: string, fields: Partial<UpdateEntry> = {}): UpdateEntry => ({
  id: `e-${(next += 1)}`,
  kind: 'edited',
  at,
  by: sam,
  ...fields,
});

describe('Updates grouping', () => {
  it('HT-08: groups per person and hour, newest first, each group at its newest entry', () => {
    const groups = groupUpdates(
      [
        entry('2026-10-27T21:40:00Z'),
        entry('2026-10-27T21:30:00Z', { by: avery }),
        entry('2026-10-27T21:05:00Z'),
        entry('2026-10-27T20:55:00Z'),
        entry('2026-10-27T20:50:00Z', { by: null }),
      ],
      TZ,
    );
    expect(groups.map((group) => [updatePerson(group.by), group.at, group.updates.length])).toEqual(
      [
        ['Sam Ortiz', '2026-10-27T21:40:00Z', 2],
        ['Avery Lin', '2026-10-27T21:30:00Z', 1],
        ['Sam Ortiz', '2026-10-27T20:55:00Z', 1],
        ['Someone', '2026-10-27T20:50:00Z', 1],
      ],
    );
  });
});

describe('Updates lines', () => {
  const text = (fields: Partial<UpdateEntry>) =>
    updateText(entry(now.toISOString(), fields), now, TZ);

  it('reads like the spec', () => {
    expect(text({ changes: 3 })).toBe('edited · 3 changes');
    expect(text({ changes: 1 })).toBe('edited · 1 change');
    expect(text({})).toBe('edited');
    expect(text({ kind: 'renamed', title: { from: 'Refund steps', to: 'Refunds' } })).toBe(
      'renamed the page from “Refund steps” to “Refunds”',
    );
    expect(
      text({ kind: 'property_changed', property: { name: 'Status', from: 'Open', to: 'Done' } }),
    ).toBe('changed Status: Open → Done');
    expect(text({ kind: 'restored', restoredFrom: '2026-10-20T21:00:00Z' })).toBe(
      'restored a version from Oct 20, 3:00 PM',
    );
    expect(text({ kind: 'commented', reply: true })).toBe('replied to a comment');
    expect(text({ kind: 'trashed' })).toBe('moved the page to Trash');
  });

  it("never names a page the person can't open", () => {
    expect(
      text({
        kind: 'moved',
        move: { from: { kind: 'top' }, to: { kind: 'page', id: 'p-1', title: 'Policies' } },
      }),
    ).toBe('moved the page from the top of the space to Policies');
    expect(
      text({
        kind: 'moved',
        move: { from: { kind: 'page', id: 'p-1', title: 'Policies' }, to: { kind: 'hidden' } },
      }),
    ).toBe("moved the page from Policies to a page you can't open");
  });
});
