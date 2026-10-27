import { describe, expect, it } from 'vitest';
import { NOTICE_KINDS, type NoticeKind } from '../types';
import { FILTER_KINDS, matchesFilter, NOTICE_FILTERS, type NoticeFilter } from './filters';

const readAt = new Date('2026-10-27T09:00:00.000Z');

/** The one chip besides All and Unread that shows each kind (null: none). */
const chipOf: Record<NoticeKind, NoticeFilter | null> = {
  reminder: 'reminders',
  alert: null,
  mention: 'mentions',
  comment: 'following',
  automation: null,
  reply: 'mentions',
  suggestion: 'following',
  suggestion_accepted: 'mentions',
  suggestion_rejected: 'mentions',
  edit_summary: 'following',
  shared: null,
  access_request: 'requests',
  import: null,
  export: null,
  review: null,
  form_response: null,
};

describe('notice filters', () => {
  it('lists the chips in the order the chat shows them', () => {
    expect([...NOTICE_FILTERS]).toEqual([
      'all',
      'mentions',
      'following',
      'reminders',
      'requests',
      'unread',
    ]);
  });

  it('shows every notice under All, and unread ones under Unread', () => {
    for (const kind of NOTICE_KINDS) {
      expect(matchesFilter('all', { kind, readAt })).toBe(true);
      expect(matchesFilter('all', { kind, readAt: null })).toBe(true);
      expect(matchesFilter('unread', { kind, readAt: null })).toBe(true);
      expect(matchesFilter('unread', { kind, readAt })).toBe(false);
    }
  });

  it('puts each kind under at most one other chip', () => {
    for (const kind of NOTICE_KINDS) {
      const chips = NOTICE_FILTERS.filter((filter) => FILTER_KINDS[filter]?.includes(kind));
      expect(chips.length).toBeLessThanOrEqual(1);
    }
  });

  for (const kind of NOTICE_KINDS) {
    const chip = chipOf[kind];
    it(`shows ${kind} notices under ${chip ?? 'All and Unread only'}`, () => {
      for (const filter of NOTICE_FILTERS) {
        if (filter === 'all' || filter === 'unread') continue;
        expect(matchesFilter(filter, { kind, readAt })).toBe(filter === chip);
      }
    });
  }
});
