import { describe, expect, it } from 'vitest';
import { QUICK_REACTIONS } from './constants';
import {
  checkAddReaction,
  normalizeReactionEmoji,
  reactedByText,
  reactionBodySchema,
  reactionChips,
  reactionToggle,
} from './reactions';
import type { Reaction } from './reactions';
import type { PersonLabel } from './types';

const people: Record<string, PersonLabel> = {
  avery: { name: 'Avery Lin' },
  sam: { name: 'Sam Ortiz' },
  riley: { name: 'Riley Chen' },
  jordan: { name: 'Jordan Patel' },
};
const nameOf = (id: string) => people[id];
const at = (minute: number) => new Date(Date.UTC(2026, 9, 26, 10, minute));
const reaction = (userId: string, emoji: string, minute: number): Reaction => ({
  userId,
  emoji,
  reactedAt: at(minute),
});
const message = { kind: 'message' as const, deleted: false };

describe('normalizeReactionEmoji', () => {
  it('accepts the quick reactions as they are', () => {
    for (const emoji of QUICK_REACTIONS) expect(normalizeReactionEmoji(emoji)).toBe(emoji);
  });

  it('accepts any single emoji, written the same way every time', () => {
    const cases: [string, string][] = [
      ['\u2764', '\u2764\uFE0F'],
      ['\u2764\uFE0E', '\u2764\uFE0F'],
      [' 🎉 ', '🎉'],
      ['👍🏽', '👍🏽'],
      ['🏳\u200D🌈', '🏳\uFE0F\u200D🌈'],
      ['1\u20E3', '1\uFE0F\u20E3'],
      ['🇺🇸', '🇺🇸'],
      ['👩\u200D👩\u200D👧\u200D👦', '👩\u200D👩\u200D👧\u200D👦'],
      ['\u261D🏻', '\u261D🏻'],
      ['©', '©\uFE0F'],
    ];
    for (const [raw, stored] of cases) expect(normalizeReactionEmoji(raw)).toBe(stored);
  });

  it('refuses anything that is not exactly one emoji', () => {
    const refused = [
      '',
      ' ',
      'a',
      'ok',
      '1',
      '#',
      ':)',
      '👍👍',
      '🇺',
      '🏻',
      '\u2764🏻',
      '★',
      ':tada:',
    ];
    for (const raw of refused) {
      expect(normalizeReactionEmoji(raw)).toBeNull();
    }
  });
});

describe('MS-18 reactions', () => {
  const reactions = [
    reaction('sam', '👍', 1),
    reaction('avery', '\u2764\uFE0F', 2),
    reaction('avery', '👍', 3),
    reaction('riley', '👍', 4),
    reaction('jordan', '👍', 5),
  ];

  it('counts each emoji, highlights yours and lists who reacted', () => {
    const chips = reactionChips([...reactions].reverse(), 'avery');
    expect(chips.map(({ emoji, count, mine }) => [emoji, count, mine])).toEqual([
      ['👍', 4, true],
      ['\u2764\uFE0F', 1, true],
    ]);
    expect(chips[0]?.userIds).toEqual(['sam', 'avery', 'riley', 'jordan']);
    expect(reactedByText({ userIds: ['avery', 'sam', 'riley', 'jordan'] }, nameOf)).toBe(
      'Avery Lin, Sam Ortiz and 2 others',
    );
    expect(reactionChips(reactions, 'casey').every((chip) => !chip.mine)).toBe(true);
  });

  it('adds yours on click, and removes it on the next click', () => {
    expect(reactionToggle(reactions, 'riley', '👍')).toBe('remove');
    expect(reactionToggle(reactions, 'riley', '\u2764')).toBe('add');
    const added = checkAddReaction({
      canReact: true,
      message,
      reactions,
      userId: 'riley',
      emoji: '\u2764',
    });
    expect(added).toEqual({ ok: true, emoji: '\u2764\uFE0F' });
  });

  it('refuses a second identical reaction, however it is written', () => {
    for (const emoji of ['👍', '\u2764', '\u2764\uFE0F']) {
      const userId = emoji === '👍' ? 'sam' : 'avery';
      expect(checkAddReaction({ canReact: true, message, reactions, userId, emoji })).toEqual({
        ok: false,
        error: 'already-reacted',
      });
    }
  });

  it('allows 20 different emoji per message', () => {
    const emoji = [...'😀😃😄😁😆😅🤣😂🙂🙃🎉👀✅🔥💯🙏👏🚀⭐🌟'];
    const twenty = emoji.map((e, i) => reaction(i % 2 ? 'sam' : 'riley', e, i));
    expect(new Set(twenty.map((r) => r.emoji)).size).toBe(20);
    const add = (e: string) =>
      checkAddReaction({ canReact: true, message, reactions: twenty, userId: 'avery', emoji: e });
    expect(add('🥳')).toEqual({ ok: false, error: 'too-many-emoji' });
    expect(add('🎉')).toEqual({ ok: true, emoji: '🎉' });
  });

  it("can't react to notices, deleted messages or chats you can't react in", () => {
    const tries = [
      { canReact: true, message: { kind: 'notice' as const, deleted: false } },
      { canReact: true, message: { kind: 'message' as const, deleted: true } },
      { canReact: false, message },
    ];
    for (const attempt of tries) {
      expect(checkAddReaction({ ...attempt, reactions, userId: 'riley', emoji: '🎉' })).toEqual({
        ok: false,
        error: 'cannot-react',
      });
    }
    expect(
      checkAddReaction({ canReact: true, message, reactions, userId: 'riley', emoji: 'ok' }),
    ).toEqual({
      ok: false,
      error: 'not-an-emoji',
    });
  });

  it('reads the request body', () => {
    expect(reactionBodySchema.parse({ emoji: '🎉' })).toEqual({ emoji: '🎉' });
    expect(reactionBodySchema.safeParse({ emoji: '' }).success).toBe(false);
    expect(reactionBodySchema.safeParse({ emoji: 'x'.repeat(65) }).success).toBe(false);
  });
});
