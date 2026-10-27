import { describe, expect, it } from 'vitest';
import {
  applyAnswer,
  asWriteEditor,
  pageText,
  targetProblem,
  TrackedTarget,
  writeTarget,
  type WriteEditor,
} from './editor';
import { br, doc, fakeEditor, mention, node, p, text } from './test-page';

// <p>Refunds take five days.</p><p>Ask Sam first.</p>: the words are at 1 to 24 and 26 to 40.
const refundSteps = () => doc(p('Refunds take five days.'), p('Ask Sam first.'));

describe("the page's text, as the server reads it", () => {
  it('puts each block on its own line, skips empty ones, and reads line breaks as spaces', () => {
    const page = doc(
      p('Refunds'),
      p(),
      node('paragraph', [text('Call'), br(), text('first')], true),
      node('bulletList', [node('listItem', [p('Card'), p(' ')])]),
      node('paragraph', [text('Ask '), mention(), text('!')], true),
    );
    expect(pageText(page, 0, page.nodeSize)).toBe('Refunds\nCall first\nCard\nAsk !');
  });

  it('cuts text at the range', () => {
    expect(pageText(refundSteps(), 9, 30)).toBe('take five days.\nAsk ');
  });
});

describe('what an action works on', () => {
  it('takes the selected words, with about where they start', () => {
    const target = writeTarget(refundSteps(), { from: 26, to: 40 }, 'make_shorter');
    expect(target).toEqual({
      action: 'make_shorter',
      from: 26,
      to: 40,
      selection: 'Ask Sam first.',
      at: 'Refunds take five days.'.length,
      canReplace: true,
    });
  });

  it('takes the block the cursor is in when nothing is selected', () => {
    const target = writeTarget(refundSteps(), { from: 5, to: 5 }, 'improve');
    expect(target).toMatchObject({ from: 1, to: 24, selection: 'Refunds take five days.' });
  });

  it('asks for a selection when a rewrite has no words', () => {
    const target = writeTarget(doc(p()), { from: 1, to: 1 }, 'fix_grammar');
    expect(targetProblem(target)).toBe('Select some text first.');
    expect(targetProblem(writeTarget(refundSteps(), { from: 2, to: 2 }, 'simplify'))).toBeNull();
  });

  it('summarizes the whole page when nothing is selected', () => {
    const target = writeTarget(refundSteps(), { from: 5, to: 5 }, 'summarize');
    expect(target).toMatchObject({ from: 5, to: 5, selection: '', canReplace: false });
    expect(targetProblem(target)).toBeNull();
  });

  it('sends the last 4,000 characters above the cursor to continue writing', () => {
    const long = 'a'.repeat(4_100);
    const target = writeTarget(doc(p(long), p('End')), { from: 4_105, to: 4_105 }, 'continue');
    expect(target.selection).toHaveLength(4_000);
    expect(target.selection.endsWith('\nEn')).toBe(true);
    expect(target.canReplace).toBe(false);
  });

  it('sends nothing from the page to draft', () => {
    expect(writeTarget(refundSteps(), { from: 1, to: 24 }, 'draft')).toMatchObject({
      selection: '',
      from: 24,
      to: 24,
      canReplace: false,
    });
  });
});

describe('following the words while Claude writes', () => {
  it('moves with edits elsewhere and notices edits to the words', () => {
    const fake = fakeEditor(refundSteps());
    const tracked = new TrackedTarget(
      fake.editor,
      writeTarget(fake.editor.state.doc, { from: 1, to: 24 }, 'improve'),
    );
    // Someone types "New: " at the start of the paragraph, just before the words.
    fake.edit(doc(p('New: Refunds take five days.'), p('Ask Sam first.')), 1, 5);
    expect(tracked.range).toEqual({ from: 6, to: 29 });
    expect(tracked.changed()).toBe(false);
    // Then changes a word inside them.
    fake.edit(doc(p('New: Refunds take 5 days.'), p('Ask Sam first.')), 40, 0);
    expect(tracked.changed()).toBe(true);
    tracked.stop();
    expect(fake.handlers.size).toBe(0);
  });

  it('never reports a change for a cursor target', () => {
    const fake = fakeEditor(refundSteps());
    const tracked = new TrackedTarget(
      fake.editor,
      writeTarget(fake.editor.state.doc, { from: 24, to: 24 }, 'continue'),
    );
    fake.edit(doc(p('Refunds take five days!!'), p('Ask Sam first.')), 23, 1);
    expect(tracked.range).toEqual({ from: 25, to: 25 });
    expect(tracked.changed()).toBe(false);
  });
});

describe('putting the answer in the page', () => {
  it('replaces the words with inline text when the answer is one paragraph', () => {
    const fake = fakeEditor(refundSteps());
    expect(
      applyAnswer(fake.editor, { from: 1, to: 24 }, 'Refunds take **5** days.', 'replace'),
    ).toBe(true);
    expect(fake.inserted).toEqual([
      [
        { from: 1, to: 24 },
        [
          { type: 'text', text: 'Refunds take ' },
          { type: 'text', text: '5', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' days.' },
        ],
      ],
    ]);
    expect(fake.focused()).toBe(true);
  });

  it('replaces whole blocks with blocks, so no empty line is left', () => {
    const fake = fakeEditor(refundSteps());
    applyAnswer(fake.editor, { from: 1, to: 40 }, '- Five days\n- Ask Sam', 'replace');
    expect(fake.inserted[0]?.[0]).toEqual({ from: 0, to: 41 });
    // Part of a block stays part of it: the editor splits the block around the answer.
    applyAnswer(fake.editor, { from: 9, to: 40 }, '- Five days\n- Ask Sam', 'replace');
    expect(fake.inserted[1]?.[0]).toEqual({ from: 9, to: 40 });
  });

  it('inserts below the block the words end in, or fills an empty line', () => {
    const fake = fakeEditor(doc(p('Refunds take five days.'), p(), p('End')));
    applyAnswer(fake.editor, { from: 5, to: 9 }, 'More.', 'insert_below');
    expect(fake.inserted[0]?.[0]).toBe(25);
    applyAnswer(fake.editor, { from: 26, to: 26 }, 'Drafted.', 'insert_below');
    expect(fake.inserted[1]?.[0]).toBe(26);
    // Words selected up to the start of the next block end before it.
    applyAnswer(fake.editor, { from: 1, to: 26 }, 'Summary.', 'insert_below');
    expect(fake.inserted[2]?.[0]).toBe(25);
  });

  it('puts only plain text into code', () => {
    const fake = fakeEditor(doc(node('codeBlock', [text('let a = 1')], true)));
    applyAnswer(fake.editor, { from: 1, to: 10 }, '**let a = 2**\n', 'replace');
    expect(fake.inserted[0]).toEqual([
      { from: 1, to: 10 },
      { type: 'text', text: '**let a = 2**' },
    ]);
  });

  it('puts nothing in for an empty answer, a closed editor or a read-only page', () => {
    const fake = fakeEditor(refundSteps());
    expect(applyAnswer(fake.editor, { from: 1, to: 24 }, '  \n', 'replace')).toBe(false);
    const readOnly = { ...fake.editor, isEditable: false } as WriteEditor;
    expect(applyAnswer(readOnly, { from: 1, to: 24 }, 'Hi', 'replace')).toBe(false);
    expect(fake.inserted).toEqual([]);
  });

  it('says false when the page refuses the answer there', () => {
    const fake = fakeEditor(refundSteps());
    const refusing = {
      ...fake.editor,
      chain: () => {
        throw new Error('Invalid content for node listItem');
      },
    } as unknown as WriteEditor;
    expect(applyAnswer(refusing, { from: 1, to: 24 }, 'Hi', 'replace')).toBe(false);
  });
});

describe('finding the editor', () => {
  it('accepts an editor and nothing else', () => {
    expect(asWriteEditor(fakeEditor(refundSteps()).editor)).not.toBeNull();
    expect(asWriteEditor(null)).toBeNull();
    expect(asWriteEditor({ chain: () => null })).toBeNull();
    expect(asWriteEditor({ chain() {}, on() {}, off() {}, state: {} })).toBeNull();
  });
});
