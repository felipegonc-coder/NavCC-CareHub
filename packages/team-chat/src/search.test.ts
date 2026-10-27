import { describe, expect, it } from 'vitest';
import {
  dateFilterRange,
  dateFilterSchema,
  foldForSearch,
  highlightRanges,
  highlightSegments,
  matchesDateFilter,
  matchesSearch,
  messageHas,
  messageSearchBodySchema,
  parseSearchQuery,
  searchVector,
  searchWords,
  toTsQuery,
} from './search';
import type { DateFilter } from './search';
import { pageLinkMatcher } from './tokens';

const matches = (text: string | string[], q: string) => matchesSearch(text, parseSearchQuery(q));

describe('MS-19 words', () => {
  it('finds "schedule" from "sched"', () => {
    expect(parseSearchQuery('sched')).toEqual({ terms: ['sched'], phrases: [] });
    expect(toTsQuery(parseSearchQuery('sched'))).toBe("'sched':*");
    expect(matches('New schedule for Monday', 'sched')).toBe(true);
    expect(matches('New schedule for Monday', 'dule')).toBe(false);
  });

  it('ignores case and accents', () => {
    expect(foldForSearch('Crème Brûlée RÉSUMÉ')).toBe('creme brulee resume');
    expect(foldForSearch('Straße Ørsted Łódź İstanbul')).toBe('strasse orsted lodz istanbul');
    expect(matches('Résumé for Casey', 'resume')).toBe(true);
    expect(matches('resume for casey', 'RÉSUMÉ')).toBe(true);
  });

  it('needs every word', () => {
    expect(matches('Coaching plan – Q4', 'plan q4')).toBe(true);
    expect(matches('Coaching plan – Q4', 'plan q3')).toBe(false);
  });

  it('keeps where each word is in the original text', () => {
    expect(searchWords('Hi Zoë, it’s')).toEqual([
      { word: 'hi', start: 0, end: 2 },
      { word: 'zoe', start: 3, end: 6 },
      { word: 'it', start: 8, end: 10 },
      { word: 's', start: 11, end: 12 },
    ]);
  });
});

describe('MS-19 exact phrases', () => {
  it('finds "quoted phrases" whole and in order', () => {
    const query = parseSearchQuery('"team meeting" sched');
    expect(query).toEqual({ terms: ['sched'], phrases: [['team', 'meeting']] });
    expect(toTsQuery(query)).toBe("'sched':* & ('team' <-> 'meeting')");
    expect(matchesSearch('Team meeting schedule', query)).toBe(true);
    expect(matchesSearch('Meeting the team about the schedule', query)).toBe(false);
  });

  it('matches whole words inside quotes, and reads curly quotes too', () => {
    expect(matches('New schedule', '"sched"')).toBe(false);
    expect(toTsQuery(parseSearchQuery('“QA form”'))).toBe("('qa' <-> 'form')");
    expect(toTsQuery(parseSearchQuery('"schedule"'))).toBe("'schedule'");
  });

  it('treats an unclosed quote as words', () => {
    expect(parseSearchQuery('plan "coaching q4')).toEqual({
      terms: ['plan', 'coaching', 'q4'],
      phrases: [],
    });
  });

  it('has nothing to match for an empty search, and caps long ones', () => {
    const empty = parseSearchQuery('  "" – ');
    expect(empty).toEqual({ terms: [], phrases: [] });
    expect(toTsQuery(empty)).toBeNull();
    expect(matchesSearch('anything', empty)).toBe(true);
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    expect(parseSearchQuery(words).terms).toHaveLength(16);
    expect(parseSearchQuery('a'.repeat(500)).terms[0]).toHaveLength(64);
  });
});

describe('search index', () => {
  it('stores words with their positions for Postgres', () => {
    expect(searchVector(['Weekly stand-up notes', null, 'Schedule.pdf'])).toBe(
      "'weekly':1 'stand':2 'up':3 'notes':4 'schedule':6 'pdf':7",
    );
    expect(searchVector(['Team, team!'])).toBe("'team':1,2");
    expect(searchVector([])).toBe('');
  });

  it('never runs a phrase from one part into the next', () => {
    const vector = searchVector(['Care Team Demo', 'Avery Lin']);
    expect(vector).toBe("'care':1 'team':2 'demo':3 'avery':5 'lin':6");
  });

  it('finds chats by name or member', () => {
    const chat = ['Care Team Demo', 'Avery Lin', 'Sam Ortiz'];
    expect(matches(chat, 'care sam')).toBe(true);
    expect(matches(chat, '"sam ortiz"')).toBe(true);
    expect(matches(chat, '"demo avery"')).toBe(false);
  });
});

describe('highlighting', () => {
  it('marks matching words and phrases', () => {
    const text = 'Can you check the QA form? The schedule is up.';
    const query = parseSearchQuery('sched "qa form"');
    const ranges = highlightRanges(text, query);
    expect(ranges.map(([start, end]) => text.slice(start, end))).toEqual(['QA form', 'schedule']);
    const segments = highlightSegments(text, ranges);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
    expect(segments.filter((segment) => segment.match).map((segment) => segment.text)).toEqual([
      'QA form',
      'schedule',
    ]);
  });

  it('merges overlapping matches', () => {
    const text = 'team meeting';
    expect(highlightRanges(text, parseSearchQuery('team "team meeting"'))).toEqual([[0, 12]]);
    expect(highlightSegments('', [])).toEqual([]);
  });
});

describe('MS-19 filters', () => {
  const matchPageLink = pageLinkMatcher({
    origins: ['https://carehub.example.com'],
    pathPrefix: '/p/',
  });

  it('knows what a message has', () => {
    const has = (text: string, kinds: ('picture' | 'pdf' | 'video')[] = [], pageCount = 0) =>
      messageHas({ text, attachmentKinds: kinds, pageCount, matchPageLink });
    expect(has('', ['picture', 'picture', 'pdf'])).toEqual(['picture', 'file']);
    expect(has('', ['video'])).toEqual(['file']);
    expect(has('See https://example.com/rota')).toEqual(['link']);
    expect(has('See https://carehub.example.com/p/page-1', [], 1)).toEqual(['pageCard']);
    expect(has('No links here')).toEqual([]);
  });

  it('filters by day: on, before, after and between', () => {
    const cases: [DateFilter, string[]][] = [
      [{ op: 'on', date: '2026-10-26' }, ['2026-10-26']],
      [{ op: 'before', date: '2026-10-26' }, ['2026-10-25']],
      [{ op: 'after', date: '2026-10-26' }, ['2026-10-27']],
      [{ op: 'between', from: '2026-10-25', to: '2026-10-26' }, ['2026-10-25', '2026-10-26']],
    ];
    const days = ['2026-10-25', '2026-10-26', '2026-10-27'];
    for (const [filter, expected] of cases) {
      expect(days.filter((day) => matchesDateFilter(day, filter))).toEqual(expected);
    }
  });

  it('turns day filters into ranges for the database', () => {
    expect(dateFilterRange({ op: 'on', date: '2026-12-31' })).toEqual({
      start: '2026-12-31',
      end: '2027-01-01',
    });
    expect(dateFilterRange({ op: 'before', date: '2026-10-26' })).toEqual({
      start: null,
      end: '2026-10-26',
    });
    expect(dateFilterRange({ op: 'after', date: '2028-02-28' })).toEqual({
      start: '2028-02-29',
      end: null,
    });
    expect(dateFilterRange({ op: 'between', from: '2026-10-01', to: '2026-10-31' })).toEqual({
      start: '2026-10-01',
      end: '2026-11-01',
    });
  });

  it('reads the request body', () => {
    expect(messageSearchBodySchema.parse({})).toEqual({ q: '' });
    const body = {
      q: '"team meeting"',
      fromUserId: 'avery',
      chatId: 'chat-1',
      date: { op: 'between', from: '2026-10-01', to: '2026-10-31' },
      has: 'pageCard',
    };
    expect(messageSearchBodySchema.parse(body)).toEqual(body);
    expect(messageSearchBodySchema.safeParse({ has: 'sticker' }).success).toBe(false);
    expect(dateFilterSchema.safeParse({ op: 'on', date: '2026-02-30' }).success).toBe(false);
    expect(dateFilterSchema.safeParse({ op: 'on', date: '26-10-2026' }).success).toBe(false);
    expect(
      dateFilterSchema.safeParse({ op: 'between', from: '2026-10-31', to: '2026-10-01' }).success,
    ).toBe(false);
  });
});
