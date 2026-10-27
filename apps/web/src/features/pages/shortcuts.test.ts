import { describe, expect, it } from 'vitest';
import { isNewPageKeys, type KeyPress } from './shortcuts';

const press = (keys: Partial<KeyPress>): KeyPress => ({
  key: 'n',
  code: 'KeyN',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...keys,
});

describe('isNewPageKeys', () => {
  it('takes Ctrl+Alt+N, and Cmd+Option+N on a Mac', () => {
    expect(isNewPageKeys(press({ ctrlKey: true, altKey: true }))).toBe(true);
    expect(isNewPageKeys(press({ ctrlKey: true, altKey: true, key: 'N' }))).toBe(true);
    expect(isNewPageKeys(press({ metaKey: true, altKey: true }))).toBe(true);
    // Option+N starts a tilde on a Mac, so the letter isn't "n" there.
    expect(isNewPageKeys(press({ metaKey: true, altKey: true, key: 'Dead' }))).toBe(true);
    expect(isNewPageKeys(press({ metaKey: true, altKey: true, key: '˜' }))).toBe(true);
  });

  it('leaves letters typed with AltGr alone', () => {
    expect(isNewPageKeys(press({ ctrlKey: true, altKey: true, key: 'ń' }))).toBe(false);
  });

  it('wants exactly Ctrl (or Cmd), Alt and N', () => {
    expect(isNewPageKeys(press({ ctrlKey: true }))).toBe(false);
    expect(isNewPageKeys(press({ altKey: true }))).toBe(false);
    expect(isNewPageKeys(press({ ctrlKey: true, altKey: true, shiftKey: true }))).toBe(false);
    expect(isNewPageKeys(press({ ctrlKey: true, metaKey: true, altKey: true }))).toBe(false);
    expect(isNewPageKeys(press({ ctrlKey: true, altKey: true, key: 'm', code: 'KeyM' }))).toBe(
      false,
    );
  });
});
