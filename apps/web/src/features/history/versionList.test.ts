import type { VersionSummary } from '@carehub/extras/history';
import { describe, expect, it } from 'vitest';
import { groupByDay, stepIndex } from './versionList';

const version = (id: string, createdAt: string): VersionSummary => ({
  id,
  kind: 'automatic',
  name: null,
  createdAt,
  editors: [{ id: 'user-avery', name: 'Avery Lin' }],
  createdBy: null,
  restoredFrom: null,
});

describe('groupByDay', () => {
  it('groups versions by their day in the time zone, newest first', () => {
    const now = new Date('2026-10-27T18:00:00.000Z'); // noon in Denver
    const versions = [
      version('v-4', '2026-10-27T17:55:00.000Z'),
      version('v-3', '2026-10-27T06:30:00.000Z'), // 12:30 AM in Denver
      version('v-2', '2026-10-27T05:30:00.000Z'), // 11:30 PM the day before
      version('v-1', '2026-10-20T15:00:00.000Z'),
    ];
    const groups = groupByDay(versions, now, 'America/Denver');
    expect(groups.map((group) => group.day)).toEqual(['Today', 'Yesterday', 'Oct 20']);
    expect(groups.map((group) => group.versions.map((one) => one.id))).toEqual([
      ['v-4', 'v-3'],
      ['v-2'],
      ['v-1'],
    ]);
  });

  it('gives nothing for no versions', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('stepIndex', () => {
  it('moves one at a time and stops at the ends', () => {
    expect(stepIndex('ArrowDown', 0, 3)).toBe(1);
    expect(stepIndex('ArrowDown', 2, 3)).toBe(2);
    expect(stepIndex('ArrowUp', 1, 3)).toBe(0);
    expect(stepIndex('ArrowUp', 0, 3)).toBe(0);
  });

  it('jumps with Home and End', () => {
    expect(stepIndex('Home', 2, 3)).toBe(0);
    expect(stepIndex('End', 0, 3)).toBe(2);
  });

  it('starts at the top when nothing in the list is selected', () => {
    expect(stepIndex('ArrowDown', -1, 3)).toBe(0);
    expect(stepIndex('ArrowUp', -1, 3)).toBe(0);
  });

  it('ignores other keys and empty lists', () => {
    expect(stepIndex('Enter', 0, 3)).toBeNull();
    expect(stepIndex('ArrowDown', -1, 0)).toBeNull();
  });
});
