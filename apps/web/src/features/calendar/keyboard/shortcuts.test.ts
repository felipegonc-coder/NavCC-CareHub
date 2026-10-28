import { describe, expect, it } from 'vitest';
import { isTyping, ownsKeys, shortcutFor, type ShortcutPress } from './shortcuts';

const press = (key: string, extra: Partial<ShortcutPress> = {}) =>
  shortcutFor({
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: null,
    ...extra,
  });

/** An element with attributes, inside `parent` if given. */
function element(tag: string, attributes: Record<string, string> = {}, parent?: HTMLElement) {
  const made = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) made.setAttribute(name, value);
  parent?.append(made);
  return made;
}

describe('shortcutFor', () => {
  it('maps T, D, W, M, J or →, K or ←, C, Delete, Esc and ?', () => {
    expect(press('t')).toEqual({ step: 'today' });
    expect(press('d')).toEqual({ view: 'day' });
    expect(press('w')).toEqual({ view: 'week' });
    expect(press('m')).toEqual({ view: 'month' });
    expect(press('j')).toEqual({ step: 'next' });
    expect(press('ArrowRight')).toEqual({ step: 'next' });
    expect(press('k')).toEqual({ step: 'previous' });
    expect(press('ArrowLeft')).toEqual({ step: 'previous' });
    expect(press('c')).toEqual({ action: 'new-event' });
    expect(press('Delete')).toEqual({ action: 'delete' });
    expect(press('Backspace')).toEqual({ action: 'delete' });
    expect(press('Escape')).toEqual({ action: 'close' });
    expect(press('?', { shiftKey: true })).toEqual({ action: 'help' });
    expect(press('x')).toBeNull();
    expect(press('ArrowUp')).toBeNull();
  });

  it('takes capitals from Caps Lock, but nothing with Shift (except ?), Ctrl, Alt or Cmd', () => {
    expect(press('D')).toEqual({ view: 'day' });
    expect(press('D', { shiftKey: true })).toBeNull();
    expect(press('ArrowRight', { shiftKey: true })).toBeNull();
    expect(press('c', { ctrlKey: true })).toBeNull();
    expect(press('ArrowLeft', { altKey: true })).toBeNull();
    expect(press('w', { metaKey: true })).toBeNull();
    expect(press('?', { ctrlKey: true, shiftKey: true })).toBeNull();
  });

  it('ignores keys already handled or held down for C, Delete, Esc and ?', () => {
    expect(press('w', { defaultPrevented: true })).toBeNull();
    expect(press('w', { isComposing: true })).toBeNull();
    expect(press('c', { repeat: true })).toBeNull();
    expect(press('Delete', { repeat: true })).toBeNull();
    expect(press('j', { repeat: true })).toEqual({ step: 'next' });
  });

  it('never acts while typing in a field', () => {
    for (const field of [
      element('input'),
      element('textarea'),
      element('select'),
      element('div', { role: 'textbox' }),
      element('div', { role: 'combobox' }),
    ]) {
      expect(press('w', { target: field })).toBeNull();
      expect(press('c', { target: field })).toBeNull();
      expect(press('Delete', { target: field })).toBeNull();
      expect(isTyping(field)).toBe(true);
    }
    expect(
      press('w', { target: { isContentEditable: true } as unknown as EventTarget }),
    ).toBeNull();
    expect(press('w', { target: element('button') })).toEqual({ view: 'week' });
    expect(isTyping(null)).toBe(false);
  });

  it('leaves the keys to dialogs, menus and lists on top of the calendar', () => {
    const dialog = element('div', { role: 'dialog' });
    const menu = element('div', { role: 'menu' });
    const inDialog = element('button', {}, dialog);
    expect(press('Escape', { target: inDialog })).toBeNull();
    expect(press('d', { target: inDialog })).toBeNull();
    expect(press('d', { target: element('div', { role: 'menuitem' }, menu) })).toBeNull();
    expect(ownsKeys(dialog)).toBe(true);
    const group = element('div', { role: 'group' });
    expect(press('d', { target: element('button', {}, group) })).toEqual({ view: 'day' });
    expect(ownsKeys(null)).toBe(false);
  });
});
