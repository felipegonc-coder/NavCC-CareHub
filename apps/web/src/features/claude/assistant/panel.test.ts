import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clampWidth,
  closeAssistant,
  isAssistantKey,
  openAssistant,
  panelState,
  setPanelLayout,
  setPanelPerson,
  setSideWidth,
  showChat,
  SIDE_WIDTH,
} from './panel';

const saved = (userId: string) =>
  JSON.parse(localStorage.getItem(`carehub.claude.assistant.${userId}`) ?? 'null') as unknown;

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  closeAssistant();
  setPanelPerson(null);
  document.body.replaceChildren();
});

describe('assistant panel state', () => {
  it('keeps the side panel between 320 and 640 px wide', () => {
    expect(clampWidth(100)).toBe(SIDE_WIDTH.min);
    expect(clampWidth(900)).toBe(SIDE_WIDTH.max);
    expect(clampWidth(450.4)).toBe(450);
  });

  it('remembers the layout and width per person on this device', () => {
    setPanelPerson('user-avery');
    expect(panelState()).toMatchObject({ layout: 'floating', sideWidth: SIDE_WIDTH.start });
    setPanelLayout('side');
    setSideWidth(520);
    expect(saved('user-avery')).toEqual({ layout: 'side', sideWidth: 520 });

    setPanelPerson('user-sam');
    expect(panelState()).toMatchObject({ person: 'user-sam', layout: 'floating' });
    setPanelPerson('user-avery');
    expect(panelState()).toMatchObject({ layout: 'side', sideWidth: 520 });
  });

  it('ignores a remembered layout it does not know', () => {
    localStorage.setItem(
      'carehub.claude.assistant.user-avery',
      JSON.stringify({ layout: 'sideways', sideWidth: 9000 }),
    );
    setPanelPerson('user-avery');
    expect(panelState()).toMatchObject({ layout: 'floating', sideWidth: SIDE_WIDTH.max });
  });

  it('closes and forgets the chat when someone else signs in on this tab', () => {
    setPanelPerson('user-avery');
    openAssistant();
    showChat('chat-1');
    setPanelPerson('user-sam');
    expect(panelState()).toMatchObject({ open: false, chatId: null, person: 'user-sam' });
  });

  it('gives focus back to what opened the panel, if it is still there', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    openAssistant();
    expect(closeAssistant()).toBe(opener);

    opener.focus();
    openAssistant();
    opener.remove();
    expect(closeAssistant()).toBeNull();
  });

  it('opens with Ctrl+Alt+J, and ⌘⌥J on a Mac', () => {
    expect(isAssistantKey(key({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: true }))).toBe(true);
    // Option changes the letter on a Mac; the key's place stays the same.
    expect(isAssistantKey(key({ key: '∆', code: 'KeyJ', metaKey: true, altKey: true }))).toBe(true);
    expect(isAssistantKey(key({ key: 'j', code: 'KeyJ', ctrlKey: true }))).toBe(false);
    expect(
      isAssistantKey(key({ key: 'J', code: 'KeyJ', ctrlKey: true, altKey: true, shiftKey: true })),
    ).toBe(false);
  });
});
