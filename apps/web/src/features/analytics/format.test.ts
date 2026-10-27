import { describe, expect, it } from 'vitest';
import { countOf, countText, dayText, pageName, shortDayText, todayIn } from './format';

describe('format', () => {
  it('writes counts with thousands separators and the right word', () => {
    expect(countText(1234567)).toBe('1,234,567');
    expect(countOf(1, 'view', 'views')).toBe('1 view');
    expect(countOf(0, 'view', 'views')).toBe('0 views');
    expect(countOf(2500, 'edit', 'edits')).toBe('2,500 edits');
  });

  it('writes days as they are, whatever the time zone of the computer', () => {
    expect(shortDayText('2026-10-21')).toBe('Oct 21');
    expect(dayText('2026-10-21')).toBe('October 21, 2026');
    expect(dayText('2026-01-01')).toBe('January 1, 2026');
  });

  it('marks pages in the Trash and deleted pages, which keep their numbers', () => {
    expect(pageName({ title: 'Refund policy', state: 'live' })).toBe('Refund policy');
    expect(pageName({ title: 'Refund policy', state: null })).toBe('Refund policy');
    expect(pageName({ title: 'Shift notes', state: 'trash' })).toBe('Shift notes (in Trash)');
    expect(pageName({ title: 'Old rota', state: 'deleted' })).toBe('Old rota (deleted)');
    expect(pageName({ title: '  ', state: 'live' })).toBe('Untitled');
    expect(pageName({ title: '', state: 'deleted' })).toBe('Untitled (deleted)');
  });

  it("gives today's date in a time zone", () => {
    const now = new Date('2026-10-27T05:00:00Z');
    expect(todayIn('America/Denver', now)).toBe('2026-10-26');
    expect(todayIn('UTC', now)).toBe('2026-10-27');
    expect(todayIn('Asia/Tokyo', now)).toBe('2026-10-27');
  });
});
