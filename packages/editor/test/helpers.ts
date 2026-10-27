import type { AnyExtension } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import type { Transaction } from '@tiptap/pm/state';
import { Editor } from '@tiptap/react';
import * as Y from 'yjs';
import { createBlockExtensions } from '../src/extensions';
import type { SlashMenuStore } from '../src/slash';

export const testUser = { id: 'user-1', name: 'Robin Example', color: '#2563eb' };

/** Lets timers and promises run (Yjs binds on a 0 ms timer, the "/" menu updates async). */
export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function createTestEditor(
  options: { ydoc?: Y.Doc; slashMenu?: SlashMenuStore; extensions?: AnyExtension[] } = {},
) {
  const element = document.createElement('div');
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: createBlockExtensions({
      ydoc: options.ydoc ?? new Y.Doc(),
      slashMenu: options.slashMenu,
      extensions: options.extensions,
    }),
  });
  await flush();
  return editor;
}

type TextInputHandler = (
  view: EditorView,
  from: number,
  to: number,
  text: string,
  insert: () => Transaction,
) => boolean | void;

/** Types like a person: one character at a time, so input rules run. */
export function typeText(editor: Editor, text: string) {
  for (const char of text) {
    const { view } = editor;
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(char, from, to);
    const handled = view.someProp('handleTextInput', (handler) =>
      (handler as TextInputHandler)(view, from, to, char, insert),
    );
    if (!handled) view.dispatch(insert());
  }
}

/** Sends a keydown to the editor; returns true if the editor handled it. */
export function pressKey(editor: Editor, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  editor.view.dom.dispatchEvent(event);
  return event.defaultPrevented;
}
