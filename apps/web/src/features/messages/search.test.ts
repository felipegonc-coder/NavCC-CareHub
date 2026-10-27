import { describe, expect, it } from 'vitest';
import { highlightRanges, parseSearchQuery } from '@carehub/team-chat';
import {
  dateFilterOf,
  dateLabel,
  fromChoices,
  inChoices,
  matchingChats,
  NO_FILTERS,
  searchBody,
  snippet,
} from './search';
import { AVERY, chat, people, RILEY, SAM } from './test-data';

const TODAY = '2026-10-27';

describe('message search', () => {
  it('turns the Date choices into days, waiting for the ones it needs', () => {
    const date = (change: Partial<typeof NO_FILTERS>) =>
      dateFilterOf({ ...NO_FILTERS, ...change }, TODAY);
    expect(date({})).toBeUndefined();
    expect(date({ date: 'today' })).toEqual({ op: 'on', date: TODAY });
    expect(date({ date: 'week' })).toEqual({ op: 'between', from: '2026-10-21', to: TODAY });
    expect(date({ date: 'month' })).toEqual({ op: 'between', from: '2026-09-28', to: TODAY });
    expect(date({ date: 'before' })).toBeUndefined();
    expect(date({ date: 'before', day: '2026-10-01' })).toEqual({
      op: 'before',
      date: '2026-10-01',
    });
    expect(date({ date: 'between', day: '2026-10-20' })).toBeUndefined();
    const label = (change: Partial<typeof NO_FILTERS>) => dateLabel({ ...NO_FILTERS, ...change });
    expect(label({})).toBe('Date');
    expect(label({ date: 'week' })).toBe('Past 7 days');
    expect(label({ date: 'on', day: '2026-10-26' })).toBe('On Oct 26');
    expect(label({ date: 'between', day: '2026-10-02' })).toBe('Oct 2 – …');
    expect(date({ date: 'between', day: '2026-10-20', lastDay: '2026-10-02' })).toEqual({
      op: 'between',
      from: '2026-10-02',
      to: '2026-10-20',
    });
  });

  it('asks nothing without words or filters, and sends only the filters that are set', () => {
    expect(searchBody('  ', NO_FILTERS, TODAY)).toBeNull();
    expect(searchBody('"" !!', NO_FILTERS, TODAY)).toBeNull();
    expect(searchBody(' sched ', NO_FILTERS, TODAY)).toEqual({ q: 'sched' });
    expect(searchBody('', { ...NO_FILTERS, has: 'link', fromUserId: SAM }, TODAY)).toEqual({
      q: '',
      fromUserId: SAM,
      has: 'link',
    });
    expect(searchBody('', { ...NO_FILTERS, date: 'on' }, TODAY)).toBeNull();
  });

  it('finds chats by name or by members other than you, and Care Hub by its name', () => {
    const group = chat({
      id: 'c-2',
      type: 'group',
      name: 'Weekend rota',
      members: [
        ...chat().members,
        { userId: RILEY, joinedAt: '2026-10-26T16:00:00.000Z', canRemoveOthers: false },
      ],
    });
    const answer = { viewerId: AVERY, chats: [chat(), group], people };
    const ids = (text: string) =>
      matchingChats(answer, parseSearchQuery(text)).chats.map((found) => found.id);
    expect(ids('sam')).toEqual(['c-1', 'c-2']);
    expect(ids('rota')).toEqual(['c-2']);
    expect(ids('riley')).toEqual(['c-2']);
    expect(ids('avery')).toEqual([]);
    expect(matchingChats(answer, parseSearchQuery('care')).careHub).toBe(true);
    expect(matchingChats(answer, parseSearchQuery('')).chats).toEqual([]);
    expect(fromChoices(answer).map((choice) => choice.label)).toEqual([
      'You',
      'Riley Chen (removed)',
      'Sam Ortiz',
    ]);
    expect(inChoices(answer)).toEqual([
      { value: 'c-1', label: 'Sam Ortiz' },
      { value: 'c-2', label: 'Weekend rota' },
    ]);
  });

  it('starts a long message shortly before its first match, at a word', () => {
    const text = `${'Notes from the morning handover about the weekend, '.repeat(2)}then the schedule.`;
    const query = parseSearchQuery('sched');
    const cut = snippet(text, highlightRanges(text, query));
    expect(cut.text.startsWith('…')).toBe(true);
    expect(cut.text.endsWith('then the schedule.')).toBe(true);
    const [range] = cut.ranges;
    expect(range && cut.text.slice(range[0], range[1])).toBe('schedule');
    expect(snippet('The schedule', highlightRanges('The schedule', query)).text).toBe(
      'The schedule',
    );
  });
});
