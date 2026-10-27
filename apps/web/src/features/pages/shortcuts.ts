/** The keys of a key press that a shortcut looks at. */
export type KeyPress = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>;

/**
 * Ctrl+Alt+N, or Cmd+Option+N on a Mac: New page (Sidebar spec, section 2). On a Mac, Option
 * changes the letter (Option+N starts a "˜"), so there the key's place counts. Elsewhere Ctrl+Alt
 * can stand for AltGr, which types letters such as "ń", so only an "n" counts.
 */
export function isNewPageKeys(event: KeyPress): boolean {
  if (event.ctrlKey === event.metaKey || !event.altKey || event.shiftKey) return false;
  return event.key.toLowerCase() === 'n' || (event.metaKey && event.code === 'KeyN');
}
