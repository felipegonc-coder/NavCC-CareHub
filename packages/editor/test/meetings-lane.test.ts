import type { JSONContent } from '@tiptap/core';
import {
  DOMParser as ProseMirrorParser,
  DOMSerializer,
  type Node as ProseMirrorNode,
} from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createPageSchema } from '../src/schema';
import { createTestEditor, flush } from './helpers';

// The Meetings lane's blocks (src/lanes/meetings.ts): the meeting notes block and its two parts.

const heading = (text: string): JSONContent => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [{ type: 'text', text }],
});
const line = (): JSONContent => ({ type: 'paragraph' });

/** A new block, as Take meeting notes makes it. */
function notesBlock(notesId: string | null = 'notes-1'): JSONContent {
  return {
    type: 'meetingNotes',
    attrs: { notesId },
    content: [
      heading('Agenda'),
      line(),
      { type: 'meetingDetails' },
      heading('Notes'),
      line(),
      heading('Action items'),
      {
        type: 'taskList',
        content: [{ type: 'taskItem', attrs: { checked: false }, content: [line()] }],
      },
      heading('Summary'),
      line(),
      { type: 'meetingTranscript' },
    ],
  };
}

const page = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

/** A block's children: the sections' headings by their text, the other blocks by their type. */
function outline(block: ProseMirrorNode | null | undefined): string[] {
  const names: string[] = [];
  block?.forEach((child) => {
    names.push(child.type.name === 'heading' ? child.textContent : child.type.name);
  });
  return names;
}

const NEW_BLOCK = [
  'Agenda',
  'paragraph',
  'meetingDetails',
  'Notes',
  'paragraph',
  'Action items',
  'taskList',
  'Summary',
  'paragraph',
  'meetingTranscript',
];

/** How many nodes of `type` the document has. */
function count(doc: ProseMirrorNode, type: string): number {
  let found = 0;
  doc.descendants((node) => {
    if (node.type.name === type) found += 1;
  });
  return found;
}

/** The position just before the first node of `type`. */
function positionOf(doc: ProseMirrorNode, type: string): number {
  let at = -1;
  doc.descendants((node, pos) => {
    if (at === -1 && node.type.name === type) at = pos;
    return at === -1;
  });
  if (at === -1) throw new Error(`No ${type} in the page`);
  return at;
}

describe('the meeting notes block', () => {
  it('goes anywhere a block goes, and its parts only inside a block', () => {
    const { nodes } = createPageSchema();
    const [doc, notes, details, transcript] = [
      nodes.doc,
      nodes.meetingNotes,
      nodes.meetingDetails,
      nodes.meetingTranscript,
    ];
    if (!doc || !notes || !details || !transcript) throw new Error('A Meetings node is missing');
    expect(notes.spec.group).toBe('block');
    expect(doc.contentMatch.matchType(notes)).not.toBeNull();
    expect(doc.contentMatch.matchType(details)).toBeNull();
    expect(doc.contentMatch.matchType(transcript)).toBeNull();
    expect(details.isAtom && transcript.isAtom).toBe(true);
  });

  it('keeps a new block as Take meeting notes makes it: its notes row and sections in order', () => {
    const doc = createPageSchema().nodeFromJSON(page(notesBlock(), line()));
    expect(() => doc.check()).not.toThrow();
    expect(doc.firstChild?.type.name).toBe('meetingNotes');
    expect(doc.firstChild?.attrs.notesId).toBe('notes-1');
    expect(outline(doc.firstChild)).toEqual(NEW_BLOCK);
  });

  it('has exactly one of each part, Attendees and Video link before Your transcript', () => {
    const schema = createPageSchema();
    const valid = (block: JSONContent) => {
      try {
        schema.nodeFromJSON(page(block)).check();
        return true;
      } catch {
        return false;
      }
    };
    const withContent = (content: JSONContent[]) => ({ ...notesBlock(), content });
    const children = notesBlock().content ?? [];
    const without = (type: string) => withContent(children.filter((node) => node.type !== type));
    expect(valid(notesBlock())).toBe(true);
    expect(valid(without('meetingDetails'))).toBe(false);
    expect(valid(without('meetingTranscript'))).toBe(false);
    expect(valid(withContent([...children, { type: 'meetingTranscript' }]))).toBe(false);
    expect(valid(withContent([...children, ...children]))).toBe(false);
    expect(
      valid(withContent([{ type: 'meetingDetails' }, line(), { type: 'meetingTranscript' }])),
    ).toBe(true);
    expect(
      valid(withContent([{ type: 'meetingTranscript' }, line(), { type: 'meetingDetails' }])),
    ).toBe(false);
  });

  it('gets a part back in its place when an edit removes it', () => {
    const doc = createPageSchema().nodeFromJSON(page(notesBlock(), line()));
    for (const type of ['meetingDetails', 'meetingTranscript']) {
      const at = positionOf(doc, type);
      const { tr } = EditorState.create({ doc });
      tr.delete(at, at + 1);
      expect(() => tr.doc.check()).not.toThrow();
      expect(outline(tr.doc.firstChild)).toEqual(NEW_BLOCK);
    }
  });

  it('keeps its parts and a line to write in when everything in it is deleted', () => {
    const doc = createPageSchema().nodeFromJSON(page(notesBlock(), line()));
    const block = doc.firstChild;
    if (!block) throw new Error('No block');
    const { tr } = EditorState.create({ doc });
    tr.delete(1, block.nodeSize - 1);
    expect(() => tr.doc.check()).not.toThrow();
    expect(tr.doc.firstChild?.attrs.notesId).toBe('notes-1');
    expect(count(tr.doc, 'meetingDetails')).toBe(1);
    expect(count(tr.doc, 'meetingTranscript')).toBe(1);
    expect(count(tr.doc, 'paragraph')).toBeGreaterThan(1);
    expect(tr.doc.textContent).toBe('');
  });

  it('keeps its notes row and sections through HTML, as copy and paste do', () => {
    const schema = createPageSchema();
    const html = document.createElement('div');
    html.append(
      DOMSerializer.fromSchema(schema).serializeFragment(
        schema.nodeFromJSON(page(notesBlock())).content,
      ),
    );
    expect(html.innerHTML).toContain('data-type="meetingNotes"');
    expect(html.innerHTML).toContain('data-notes-id="notes-1"');
    const doc = ProseMirrorParser.fromSchema(schema).parse(html);
    expect(() => doc.check()).not.toThrow();
    expect(doc.firstChild?.attrs.notesId).toBe('notes-1');
    expect(outline(doc.firstChild)).toEqual(NEW_BLOCK);
  });

  it('leaves out a part pasted on its own', () => {
    const html = document.createElement('div');
    html.innerHTML =
      '<div data-type="meetingTranscript"></div><div data-type="meetingDetails"></div><p>Next</p>';
    const doc = ProseMirrorParser.fromSchema(createPageSchema()).parse(html);
    expect(count(doc, 'meetingTranscript') + count(doc, 'meetingDetails')).toBe(0);
    expect(count(doc, 'meetingNotes')).toBe(0);
    expect(doc.textContent).toBe('Next');
  });
});

describe('the meeting notes block without its web view', () => {
  const editors: Editor[] = [];
  afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

  it('says it needs Meetings, keeps its sections, and is stored in the Y.Doc', async () => {
    const ydoc = new Y.Doc();
    const editor = await createTestEditor({ ydoc });
    editors.push(editor);
    editor.commands.insertContent(notesBlock());
    await flush();
    const box = editor.view.dom.querySelector('.ch-lane-block');
    expect(box?.textContent).toContain('This block needs Meetings.');
    expect(box?.textContent).toContain('Action items');
    expect(editor.getJSON().content?.map((node) => node.type)).toContain('meetingNotes');
    expect(ydoc.getXmlFragment('default').toString()).toContain('notes-1');
  });
});
