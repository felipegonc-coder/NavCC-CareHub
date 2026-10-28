import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  askClaudeBubbleItem,
  askClaudeSlashItem,
  canAskClaude,
  onAskClaude,
  onAskClaudeKey,
  openAskClaude,
} from './open';
import { setWritingHelpOn } from './status';
import { doc, fakeEditor, p } from './test-page';

const PAGE = '6f1c2b8a-3d4e-4f5a-9b6c-7d8e9f0a1b2c';

/** An editor in a page, as the page view draws it. */
function pageEditor() {
  const holder = document.createElement('div');
  holder.dataset.pageId = PAGE;
  const dom = document.createElement('div');
  dom.className = 'ch-editor';
  holder.append(dom);
  document.body.append(holder);
  const fake = fakeEditor(doc(p('Refunds take five days.')), { from: 1, to: 8 }, dom);
  Object.assign(dom, { editor: fake.editor });
  return { ...fake, dom };
}

describe('Ask Claude entry points', () => {
  beforeEach(() => setWritingHelpOn(true));
  afterEach(() => {
    setWritingHelpOn(false);
    document.body.replaceChildren();
  });

  it('show only while writing help is on, in a page the person can edit (CL-01, CL-04)', () => {
    const { editor } = pageEditor();
    expect(canAskClaude(editor)).toBe(true);
    expect(askClaudeSlashItem.isVisible(editor)).toBe(true);
    expect(askClaudeBubbleItem.isVisible(editor)).toBe(true);
    expect(askClaudeSlashItem.group).toBe('Actions');

    setWritingHelpOn(false);
    expect(canAskClaude(editor)).toBe(false);
    expect(askClaudeBubbleItem.isVisible(editor)).toBe(false);

    setWritingHelpOn(true);
    expect(canAskClaude({ ...editor, isEditable: false })).toBe(false);
    expect(canAskClaude(null)).toBe(false);
  });

  it('need a page to work in', () => {
    const dom = document.createElement('div');
    document.body.append(dom);
    const { editor } = fakeEditor(doc(p('Hi')), { from: 1, to: 1 }, dom);
    expect(canAskClaude(editor)).toBe(false);
  });

  it('open Ask Claude on the editor', () => {
    const { editor } = pageEditor();
    const heard = vi.fn();
    const stop = onAskClaude(heard);
    askClaudeSlashItem.run(editor);
    askClaudeBubbleItem.run(editor);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(heard).toHaveBeenLastCalledWith({ editor, pageId: PAGE });
    stop();
    expect(openAskClaude(editor)).toBe(false);
  });

  it('open with Ctrl+J or ⌘J in a page, but not with Ctrl+Alt+J or while off', () => {
    const { dom } = pageEditor();
    const heard = vi.fn();
    const stop = onAskClaude(heard);
    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', {
        key: 'j',
        code: 'KeyJ',
        bubbles: true,
        cancelable: true,
        ...init,
      });
      dom.dispatchEvent(event);
      return event.defaultPrevented;
    };
    document.addEventListener('keydown', onAskClaudeKey);
    try {
      expect(press({ ctrlKey: true })).toBe(true);
      expect(press({ metaKey: true })).toBe(true);
      expect(press({ ctrlKey: true, altKey: true })).toBe(false);
      expect(press({})).toBe(false);
      expect(heard).toHaveBeenCalledTimes(2);
      setWritingHelpOn(false);
      expect(press({ ctrlKey: true })).toBe(false);
      expect(heard).toHaveBeenCalledTimes(2);
    } finally {
      document.removeEventListener('keydown', onAskClaudeKey);
      stop();
    }
  });
});
