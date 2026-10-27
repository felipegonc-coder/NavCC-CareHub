// Which notice a new response gets: the first of a run on its own, later ones grouped, with generic
// titles that never name the sender.
import { describe, expect, it } from 'vitest';
import { noticeTitle, runLength } from './notify';

const at = (minutes: number) => new Date(Date.parse('2026-10-27T15:00:00Z') + minutes * 60_000);

describe('runLength', () => {
  it('counts the responses that came within 5 minutes of the one before', () => {
    expect(runLength([])).toBe(0);
    expect(runLength([at(0)])).toBe(1);
    expect(runLength([at(12), at(9), at(5), at(1)])).toBe(4);
    expect(runLength([at(12), at(9), at(4), at(1)])).toBe(2);
    expect(runLength([at(20), at(10)])).toBe(1);
    expect(runLength([at(5), at(0)])).toBe(1);
    expect(runLength([at(4.99), at(0)])).toBe(2);
  });
});

describe('noticeTitle', () => {
  it('says how many new responses the grouped notice holds', () => {
    expect(noticeTitle(1, false)).toBe('New response');
    expect(noticeTitle(1, true)).toBe('New anonymous response');
    // The second response of a run starts the grouped notice.
    expect(noticeTitle(2, false)).toBe('New response');
    expect(noticeTitle(2, true)).toBe('New anonymous response');
    expect(noticeTitle(4, false)).toBe('3 new responses');
    expect(noticeTitle(4, true)).toBe('3 new responses');
  });
});
