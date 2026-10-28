import { createPageSchema } from '@carehub/editor/schema';
import { describe, expect, it } from 'vitest';
import { notesBlock, notesPage } from './notes-doc';

const NOTES_ID = '0f8b6c1e-3d2a-4b7c-9e15-6a4d2c8f1b30';

describe('notesPage', () => {
  it("is page content the editor's schema keeps as it is, with the block first", () => {
    const doc = createPageSchema().nodeFromJSON(notesPage(NOTES_ID));
    expect(() => doc.check()).not.toThrow();
    expect(doc.toJSON()).toMatchObject(notesPage(NOTES_ID));
    expect(doc.childCount).toBe(2);
    expect(doc.firstChild?.type.name).toBe('meetingNotes');
    expect(doc.firstChild?.attrs.notesId).toBe(NOTES_ID);
    expect(doc.lastChild?.type.name).toBe('paragraph');
  });

  it('gives each page its own copy', () => {
    const first = notesPage(NOTES_ID);
    const second = notesPage(NOTES_ID);
    expect(second).toEqual(first);
    expect(second.content?.[0]).not.toBe(first.content?.[0]);
  });
});

describe('notesBlock', () => {
  it('has the sections in order, with one empty to-do under Action items (MT-01)', () => {
    const block = createPageSchema().nodeFromJSON(notesBlock(NOTES_ID));
    const outline: string[] = [];
    block.forEach((child) => {
      outline.push(child.type.name === 'heading' ? `## ${child.textContent}` : child.type.name);
    });
    expect(outline).toEqual([
      '## Agenda',
      'paragraph',
      'meetingDetails',
      '## Notes',
      'paragraph',
      '## Action items',
      'taskList',
      '## Summary',
      'paragraph',
      'meetingTranscript',
    ]);
    const todos = block.child(6);
    expect(todos.childCount).toBe(1);
    expect(todos.firstChild?.type.name).toBe('taskItem');
    expect(todos.firstChild?.attrs.checked).toBe(false);
    expect(todos.textContent).toBe('');
  });
});
