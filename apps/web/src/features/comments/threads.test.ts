import type { CommentThreadView } from '@carehub/shared';
import { describe, expect, it } from 'vitest';
import { comment, PEOPLE, thread } from './testServer';
import { formatWhen, nameOf, textParts, visibleThreads } from './threads';

const ids = (threads: CommentThreadView[]) => threads.map((each) => each.id);
const view = { tab: 'open', filter: 'all', order: 'position' } as const;

describe('visibleThreads', () => {
  it('shows the open or the resolved threads', () => {
    const threads = [
      thread({ id: 'open' }),
      thread({ id: 'done', resolvedAt: '2026-10-27T10:00:00.000Z' }),
    ];
    expect(ids(visibleThreads(threads, view))).toEqual(['open']);
    expect(ids(visibleThreads(threads, { ...view, tab: 'resolved' }))).toEqual(['done']);
  });

  it('puts the page first, then properties, then the content from top to bottom', () => {
    const threads = [
      thread({ id: 'lower', spot: 'text', blockId: 'b2', quote: 'call the clinic' }),
      thread({ id: 'gone', spot: 'block', blockId: 'b0', createdAt: '2026-10-27T08:00:00.000Z' }),
      thread({ id: 'upper', spot: 'block', blockId: 'b1' }),
      thread({ id: 'property', spot: 'property', propertyId: 'due' }),
      thread({ id: 'page' }),
    ];
    const at: Record<string, number | null> = { b0: null, b1: 10, b2: 20 };
    const locate = (each: CommentThreadView) => (each.blockId ? at[each.blockId] : undefined);
    expect(ids(visibleThreads(threads, { ...view, locate }))).toEqual([
      'page',
      'property',
      'upper',
      'lower',
      'gone',
    ]);
    // With no editor to ask, the content's threads keep the order they were started in.
    expect(ids(visibleThreads(threads, view))).toEqual([
      'page',
      'property',
      'gone',
      'lower',
      'upper',
    ]);
  });

  it('puts the latest activity first for Newest first', () => {
    const threads = [
      thread({ id: 'older', lastCommentAt: '2026-10-27T09:00:00.000Z' }),
      thread({ id: 'newer', lastCommentAt: '2026-10-27T11:00:00.000Z' }),
    ];
    expect(ids(visibleThreads(threads, { ...view, order: 'newest' }))).toEqual(['newer', 'older']);
  });

  it('keeps For me to threads that mention you or that you wrote in', () => {
    const threads = [
      thread({ id: 'wrote', comments: [comment(), comment({ id: 'c-2', authorId: 'sam' })] }),
      thread({ id: 'mentioned', comments: [comment({ text: 'Is Thursday OK, <@sam>?' })] }),
      thread({ id: 'other' }),
    ];
    const forMe = { ...view, filter: 'forMe' } as const;
    expect(ids(visibleThreads(threads, { ...forMe, viewerId: 'sam' }))).toEqual([
      'wrote',
      'mentioned',
    ]);
    expect(visibleThreads(threads, forMe)).toEqual([]);
  });
});

describe('textParts', () => {
  it('splits out the people mentioned', () => {
    expect(textParts('Hi <@sam>, ask <@avery-lin>.')).toEqual([
      { text: 'Hi ' },
      { userId: 'sam' },
      { text: ', ask ' },
      { userId: 'avery-lin' },
      { text: '.' },
    ]);
    expect(textParts('<@sam>')).toEqual([{ userId: 'sam' }]);
    expect(textParts('No one, <@>.')).toEqual([{ text: 'No one, <@>.' }]);
  });
});

describe('nameOf', () => {
  it('shows (removed) for someone no longer in the workspace', () => {
    expect(nameOf(PEOPLE, 'sam')).toBe('Sam Ortiz');
    expect(nameOf(PEOPLE, 'left-in-2025')).toBe('(removed)');
  });
});

describe('formatWhen', () => {
  const now = new Date(2026, 9, 27, 15, 0);
  const at = (day: number, hours: number, minutes = 0, seconds = 0) =>
    new Date(2026, 9, day, hours, minutes, seconds).toISOString();

  it('says how long ago, then the time today, then the day', () => {
    expect(formatWhen(at(27, 14, 59, 30), now)).toBe('Just now');
    expect(formatWhen(at(27, 14, 55), now)).toBe('5 min ago');
    expect(formatWhen(at(27, 9, 30), now)).toMatch(/9:30/);
    expect(formatWhen(at(20, 9, 30), now)).toMatch(/20/);
    expect(formatWhen(new Date(2025, 9, 20).toISOString(), now)).toMatch(/2025/);
  });
});
