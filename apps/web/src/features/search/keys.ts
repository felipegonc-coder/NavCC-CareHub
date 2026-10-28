import { fold, type TextRange } from '@carehub/extras/search';
import type { Command } from '../../slots';

type Keys = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/** Ctrl+K or Ctrl+P (⌘K or ⌘P on a Mac) open search from anywhere (spec 6). */
export function isSearchShortcut(event: Keys): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
  const key = event.key.toLowerCase();
  // `code` keeps the keys working with other keyboard layouts.
  return key === 'k' || key === 'p' || event.code === 'KeyK' || event.code === 'KeyP';
}

/** "⌘" on a Mac, else "Ctrl". */
export const modifierLabel = (userAgent: string) =>
  /Mac|iPhone|iPad/.test(userAgent) ? '⌘' : 'Ctrl';

/** "⌘K" on a Mac, else "Ctrl K". */
export function shortcutLabel(userAgent: string): string {
  const modifier = modifierLabel(userAgent);
  return modifier === '⌘' ? '⌘K' : `${modifier} K`;
}

/** The parts of `text`, each marked as a match or not, for bold titles and highlighted snippets. */
export function segments(text: string, ranges: readonly TextRange[]) {
  const parts: { text: string; match: boolean }[] = [];
  let at = 0;
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const from = Math.max(start, at);
    if (end <= from) continue;
    if (from > at) parts.push({ text: text.slice(at, from), match: false });
    parts.push({ text: text.slice(from, end), match: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false });
  return parts;
}

/**
 * Commands whose title or keywords have a word starting with each typed word, as Actions.
 * Commands that need a permission are left out until the web app can check permissions.
 */
export function matchCommands(commands: readonly Command[], text: string, limit = 3): Command[] {
  const typed = fold(text).split(/\s+/).filter(Boolean);
  if (typed.length === 0) return [];
  return commands
    .filter((command) => {
      // stand-in: usePermission (accounts, decision 0007 4.3) shows these to people allowed.
      if (command.permission) return false;
      const words = fold([command.title, ...(command.keywords ?? [])].join(' ')).split(
        /[^\p{L}\p{N}]+/u,
      );
      return typed.every((part) => words.some((word) => word.startsWith(part)));
    })
    .slice(0, limit);
}
