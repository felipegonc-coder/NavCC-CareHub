import { describe, expect, it } from 'vitest';
import { isTyping, shortcutFor } from './shortcuts';

const press = (key: string, extra: Partial<Parameters<typeof shortcutFor>[0]> = {}) =>
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

describe('shortcutFor', () => {
  it('maps T, D, W, M, J, K and the arrows', () => {
    expect(press('t')).toEqual({ step: 'today' });
    expect(press('d')).toEqual({ view: 'day' });
    expect(press('w')).toEqual({ view: 'week' });
    expect(press('M')).toEqual({ view: 'month' });
    expect(press('j')).toEqual({ step: 'next' });
    expect(press('ArrowRight')).toEqual({ step: 'next' });
    expect(press('k')).toEqual({ step: 'previous' });
    expect(press('ArrowLeft')).toEqual({ step: 'previous' });
    expect(press('x')).toBeNull();
  });

  it('ignores modifiers, handled keys and typing in fields', () => {
    expect(press('w', { ctrlKey: true })).toBeNull();
    expect(press('w', { metaKey: true })).toBeNull();
    expect(press('w', { altKey: true })).toBeNull();
    expect(press('W', { shiftKey: true })).toBeNull();
    expect(press('w', { defaultPrevented: true })).toBeNull();
    expect(press('w', { target: { tagName: 'INPUT' } as unknown as EventTarget })).toBeNull();
    expect(press('w', { target: { tagName: 'TEXTAREA' } as unknown as EventTarget })).toBeNull();
    expect(
      press('w', { target: { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget }),
    ).toBeNull();
    expect(press('w', { target: { tagName: 'BUTTON' } as unknown as EventTarget })).toEqual({
      view: 'week',
    });
  });

  it('knows fields', () => {
    expect(isTyping(null)).toBe(false);
    expect(isTyping({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
  });
});
