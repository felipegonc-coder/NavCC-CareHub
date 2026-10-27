import { describe, expect, it } from 'vitest';
import { reviewTokenFrom } from './token';

// Built from a short pattern, so it doesn't look like a real secret: 43 base64url characters.
const TOKEN = 'Ab0-_'.repeat(8) + 'Ab0';

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
