import { describe, expect, it } from 'vitest';
import { reviewTokenFrom } from './token';

const TOKEN = 'q3J5_b-Z0xY7wV2uT9sR4pO1nM6lK8jI3hG5fE0dC2a';

describe('review link token', () => {
  it('reads the token from the fragment', () => {
    expect(TOKEN).toHaveLength(43);
    expect(reviewTokenFrom(`#${TOKEN}`)).toBe(TOKEN);
  });

  it('refuses a missing, short, long or odd token', () => {
    for (const hash of [
      '',
      '#',
      `#${TOKEN.slice(1)}`,
      `#${TOKEN}A`,
      `#${TOKEN.slice(1)}=`,
      '#../x',
    ]) {
      expect(reviewTokenFrom(hash)).toBeNull();
    }
  });
});
