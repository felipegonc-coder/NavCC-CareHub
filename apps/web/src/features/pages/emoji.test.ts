import { describe, expect, it } from 'vitest';
import { EMOJI_GROUPS, randomEmoji, searchEmoji } from './emoji';

const all = EMOJI_GROUPS.flatMap((group) => group.items);

describe('emoji', () => {
  it('lists each emoji once, with a name', () => {
    expect(new Set(all.map((item) => item.emoji)).size).toBe(all.length);
    expect(all.every((item) => item.name.length > 0 && item.words[0] === item.name)).toBe(true);
  });

  it('finds emoji by the start of their words, names first', () => {
    expect(searchEmoji('rock')[0]?.emoji).toBe('🚀');
    expect(searchEmoji(' Rocket ')[0]?.emoji).toBe('🚀');
    expect(searchEmoji('wave').map((item) => item.emoji)).toEqual(['👋', '🌊']);
    expect(searchEmoji('ocean')[0]?.emoji).toBe('🌊');
    expect(searchEmoji('zzz')).toEqual([]);
    expect(searchEmoji('  ')).toEqual([]);
  });

  it('picks any emoji at random', () => {
    expect(randomEmoji(() => 0)).toBe(all[0]);
    expect(randomEmoji(() => 0.9999)).toBe(all.at(-1));
  });
});
