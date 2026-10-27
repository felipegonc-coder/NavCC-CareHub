import type { JSONContent } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { revealBlock } from '../src/reveal';
import { blockIdAt, findBlock, PAGE_FIELD } from '../src/schema';
import { createTestEditor, pressKey, typeText } from './helpers';

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;

/** The page's lines: their text and block ID. */
const lines = (e: Editor) => {
  const found: [string, unknown][] = [];
  e.state.doc.descendants((node) => {
    if (node.isTextblock) found.push([node.textContent, node.attrs.blockId]);
    return !node.isTextblock;
  });
  return found;
};
const idOf = (e: Editor, text: string) => lines(e).find(([line]) => line === text)?.[1];
const dividers = (e: Editor) => {
  const found: [string, unknown][] = [];
  e.state.doc.descendants((node) => {
    if (node.type.name === 'horizontalRule') found.push(['', node.attrs.blockId]);
  });
  return found;
};

const paragraph = (blockId: string, text: string): JSONContent => ({
  type: 'paragraph',
  attrs: { blockId },
  content: [{ type: 'text', text }],
});

describe('block IDs', () => {
  it('gives a line a UUID with the first thing typed, and keeps it', async () => {
    editor = await createTestEditor();
    expect(lines(editor)).toEqual([['', null]]);
    typeText(editor, 'Call');
    const id = idOf(editor, 'Call');
    expect(id).toMatch(UUID);
    typeText(editor, ' the clinic');
    expect(lines(editor)).toEqual([['Call the clinic', id]]);
    expect(editor.view.dom.querySelector('p')?.getAttribute('data-block-id')).toBe(id);
  });

  it('gives the new line a new ID on Enter, and keeps the ID with the text', async () => {
    editor = await createTestEditor();
    typeText(editor, 'Intake notes');
    const id = idOf(editor, 'Intake notes');
    pressKey(editor, 'Enter');
    typeText(editor, 'Follow-up');
    expect(lines(editor)).toEqual([
      ['Intake notes', id],
      ['Follow-up', expect.stringMatching(UUID)],
    ]);

    // Enter at the start of a line: the ID stays with the text.
    editor.commands.setTextSelection(1);
    pressKey(editor, 'Enter');
    expect(lines(editor).map(([text]) => text)).toEqual(['', 'Intake notes', 'Follow-up']);
    expect(idOf(editor, 'Intake notes')).toBe(id);

    // In the middle: the first part keeps it.
    editor.commands.setTextSelection(9);
    pressKey(editor, 'Enter');
    expect(lines(editor).map(([text]) => text)).toEqual(['', 'Intake', ' notes', 'Follow-up']);
    expect(idOf(editor, 'Intake')).toBe(id);

    const ids = lines(editor).map(([, blockId]) => blockId);
    expect(new Set(ids).size).toBe(4);
    for (const blockId of ids) expect(blockId).toMatch(UUID);
  });

  it('keeps the ID when a line turns into another block', async () => {
    editor = await createTestEditor();
    typeText(editor, 'Medication round');
    const id = idOf(editor, 'Medication round');
    editor.commands.setHeading({ level: 2 });
    expect(editor.state.doc.firstChild?.type.name).toBe('heading');
    expect(idOf(editor, 'Medication round')).toBe(id);
    editor.commands.setParagraph();
    editor.commands.toggleBulletList();
    expect(editor.state.doc.firstChild?.type.name).toBe('bulletList');
    expect(idOf(editor, 'Medication round')).toBe(id);
    expect(editor.view.dom.querySelector('li')?.hasAttribute('data-block-id')).toBe(false);
  });

  it('keeps the ID when a Markdown shortcut is typed before the text', async () => {
    editor = await createTestEditor();
    typeText(editor, 'Medication round');
    const id = idOf(editor, 'Medication round');
    editor.commands.setTextSelection(1);
    typeText(editor, '## ');
    expect(editor.state.doc.firstChild?.type.name).toBe('heading');
    expect(idOf(editor, 'Medication round')).toBe(id);
  });

  it('gives a heading made on an empty page its ID before anything is typed in it', async () => {
    const ydoc = new Y.Doc();
    editor = await createTestEditor({ ydoc });
    typeText(editor, '## ');
    expect(editor.state.doc.firstChild?.type.name).toBe('heading');
    const id = editor.state.doc.firstChild?.attrs.blockId;
    expect(id).toMatch(UUID);
    typeText(editor, 'Shift handover');
    expect(lines(editor)[0]).toEqual(['Shift handover', id]);
    // The Y.Doc has it too, so every editor shows the same ID.
    const stored = ydoc.getXmlFragment(PAGE_FIELD).get(0);
    expect(stored instanceof Y.XmlElement ? stored.getAttribute('blockId') : null).toBe(id);
  });

  it('gives a code block made on an empty page its ID at once', async () => {
    editor = await createTestEditor();
    editor.commands.setCodeBlock();
    const id = editor.state.doc.firstChild?.attrs.blockId;
    expect(id).toMatch(UUID);
    typeText(editor, 'const ward = 4;');
    expect(lines(editor)[0]).toEqual(['const ward = 4;', id]);
  });

  it('gives pasted blocks new IDs, whatever IDs the HTML has', async () => {
    editor = await createTestEditor();
    typeText(editor, 'Intake');
    const id = String(idOf(editor, 'Intake'));
    pressKey(editor, 'Enter');
    // jsdom has no ClipboardEvent, so the paste gets a plain event.
    editor.view.pasteHTML(
      `<p data-block-id="${id}">Copied</p><hr data-block-id="${id}"><p data-block-id="${id}">Twice</p>`,
      new Event('paste') as ClipboardEvent,
    );
    const ids = [...lines(editor), ...dividers(editor)].map(([, blockId]) => blockId);
    expect(lines(editor).map(([text]) => text)).toEqual(['Intake', 'Copied', 'Twice']);
    expect(idOf(editor, 'Intake')).toBe(id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    for (const blockId of ids) expect(blockId).toMatch(UUID);
  });

  it('gives a copy of a block a new ID and leaves the original its own', async () => {
    editor = await createTestEditor();
    typeText(editor, 'Intake');
    const id = idOf(editor, 'Intake');
    const copy = editor.state.doc.firstChild?.toJSON() as JSONContent;
    expect(copy.attrs?.blockId).toBe(id);
    editor.commands.insertContentAt(editor.state.doc.content.size, copy);
    expect(lines(editor)).toEqual([
      ['Intake', id],
      ['Intake', expect.stringMatching(UUID)],
    ]);
    expect(lines(editor)[1]?.[1]).not.toBe(id);
  });

  it("adds no IDs in a read-only editor or to other people's changes", async () => {
    const ydoc = new Y.Doc();
    editor = await createTestEditor({ ydoc });
    const remote = new Y.Doc();
    const line = new Y.XmlElement('paragraph');
    remote.getXmlFragment(PAGE_FIELD).insert(0, [line]);
    const text = new Y.XmlText();
    line.insert(0, [text]);
    text.insert(0, 'From another client');
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(remote), 'remote');
    expect(lines(editor)).toEqual([['From another client', null]]);

    editor.setEditable(false);
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Read only' }],
    });
    expect(lines(editor)).toEqual([
      ['From another client', null],
      ['Read only', null],
    ]);

    // Editing a line that has no ID gives it one.
    editor.setEditable(true);
    editor.commands.setTextSelection(3);
    typeText(editor, '!');
    expect(lines(editor)[0]?.[1]).toMatch(UUID);
  });

  it('finds a block by ID and the block a position belongs to', async () => {
    editor = await createTestEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [
        paragraph('intake', 'Intake'),
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [paragraph('call', 'Call back')] }],
        },
      ],
    });
    const { doc } = editor.state;
    const found = findBlock(doc, 'call');
    expect(found?.node.textContent).toBe('Call back');
    expect(found && doc.nodeAt(found.pos)).toBe(found?.node);
    expect(findBlock(doc, 'nothing')).toBeNull();
    expect(blockIdAt(doc, 3)).toBe('intake');
    // The list starts at 8: a list goes by its first line, and so do the lines in it.
    expect(blockIdAt(doc, 8)).toBe('call');
    expect(blockIdAt(doc, 13)).toBe('call');
  });
});

describe('revealBlock', () => {
  it('highlights the block for 2 seconds', async () => {
    editor = await createTestEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [paragraph('intake', 'Intake'), paragraph('call', 'Call back')],
    });
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    vi.useFakeTimers();
    try {
      expect(revealBlock(editor, 'call')).toBe(true);
      expect(scroll).toHaveBeenCalledWith({ block: 'center' });
      expect(editor.view.dom.querySelector('.ch-block-flash')?.textContent).toBe('Call back');
      vi.advanceTimersByTime(1999);
      expect(editor.view.dom.querySelector('.ch-block-flash')).not.toBeNull();
      vi.advanceTimersByTime(1);
      expect(editor.view.dom.querySelector('.ch-block-flash')).toBeNull();
      expect(revealBlock(editor, 'nothing')).toBe(false);
    } finally {
      vi.useRealTimers();
      scroll.mockRestore();
    }
  });
});
