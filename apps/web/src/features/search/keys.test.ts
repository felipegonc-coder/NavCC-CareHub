import { describe, expect, it } from 'vitest';
import type { Command } from '../../slots';
import { isSearchShortcut, matchCommands, segments, shortcutLabel } from './keys';

const press = (key: string, change: Partial<KeyboardEvent> = {}) => ({
  key,
  code: `Key${key.toUpperCase()}`,
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...change,
});

describe('isSearchShortcut', () => {
  it('takes Ctrl+K, Ctrl+P and ⌘K, ⌘P, in any keyboard layout', () => {
    expect(isSearchShortcut(press('k'))).toBe(true);
    expect(isSearchShortcut(press('P'))).toBe(true);
    expect(isSearchShortcut(press('k', { ctrlKey: false, metaKey: true }))).toBe(true);
    expect(isSearchShortcut(press('л', { code: 'KeyK' }))).toBe(true);
  });

  it('leaves other keys alone', () => {
    expect(isSearchShortcut(press('k', { ctrlKey: false }))).toBe(false);
    expect(isSearchShortcut(press('k', { shiftKey: true }))).toBe(false);
    expect(isSearchShortcut(press('k', { altKey: true }))).toBe(false);
    expect(isSearchShortcut(press('j'))).toBe(false);
  });
});

describe('shortcutLabel', () => {
  it('says ⌘K on a Mac and Ctrl K elsewhere', () => {
    expect(shortcutLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('⌘K');
    expect(shortcutLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Ctrl K');
  });
});

describe('segments', () => {
  it('splits text into matches and the rest', () => {
    expect(segments('Refund steps', [[0, 6]])).toEqual([
      { text: 'Refund', match: true },
      { text: ' steps', match: false },
    ]);
    expect(
      segments('a refund b refund', [
        [11, 17],
        [2, 8],
        [4, 6],
      ]),
    ).toEqual([
      { text: 'a ', match: false },
      { text: 'refund', match: true },
      { text: ' b ', match: false },
      { text: 'refund', match: true },
    ]);
    expect(segments('', [])).toEqual([]);
  });
});

describe('matchCommands', () => {
  const command = (title: string, change: Partial<Command> = {}): Command => ({
    id: title,
    title,
    run: () => {},
    ...change,
  });
  const commands = [
    command('Remind me about this page', { keywords: ['reminder'] }),
    command('New page'),
    command('Résumé settings'),
    command('Rebuild search index', { permission: 'siteAdmin' }),
  ];
  const titles = (text: string) => matchCommands(commands, text).map((found) => found.title);

  it('matches the beginnings of words in titles and keywords, without accents', () => {
    expect(titles('remind')).toEqual(['Remind me about this page']);
    expect(titles('REMINDER')).toEqual(['Remind me about this page']);
    expect(titles('new pa')).toEqual(['New page']);
    expect(titles('resume')).toEqual(['Résumé settings']);
    expect(titles('ind')).toEqual([]);
    expect(titles('  ')).toEqual([]);
  });

  it('leaves out commands that need a permission', () => {
    expect(titles('rebuild')).toEqual([]);
  });
});
