import { describe, expect, it } from 'vitest';
import type { Block } from '../format/index';
import { richText } from '../format/index';
import { HELP_TONE_LABELS, HELP_TONES, HelpWriteRequestSchema } from './api';
import { HELP_SYSTEM, helpAnswerText, helpWritePrompt } from './prompts';
import { blockHelpText, cutHelpSelection, helpRichText } from './text';

// Fictional course text only.
const text = richText(
  [{ text: 'Greet the caller', marks: ['bold'] }, { text: ' and say your name.' }],
  'Ask how you can help today.',
);
const paragraph: Block = { id: 'block-1', type: 'paragraph', text };

const request = {
  courseId: 'course-1',
  revision: 3,
  lessonId: 'lesson-1',
  blockId: 'block-1',
  action: 'improve',
};

describe('Learning help text', () => {
  it('reads rich text the way Studio shows it: a blank line between paragraphs, no formatting', () => {
    expect(helpRichText(text)).toBe(
      'Greet the caller and say your name.\n\nAsk how you can help today.',
    );
    expect(helpRichText(undefined)).toBe('');
    expect(blockHelpText(paragraph)).toBe(
      'Greet the caller and say your name.\n\nAsk how you can help today.',
    );
  });

  it('joins the parts of a block in a fixed order and leaves out empty ones', () => {
    const accordion: Block = {
      id: 'block-2',
      type: 'accordion',
      items: [
        { id: 'item-1', title: 'Before the call', body: richText('Open the account.') },
        { id: 'item-2', title: 'After the call', body: [] },
      ],
    };
    expect(blockHelpText(accordion)).toBe('Before the call\n\nOpen the account.\n\nAfter the call');
    const callout: Block = {
      id: 'block-3',
      type: 'callout',
      tone: 'tip',
      text: richText('Smile.'),
    };
    expect(blockHelpText(callout)).toBe('Smile.');
    expect(blockHelpText({ id: 'block-4', type: 'heading', level: 2, text: 'Wrap-up' })).toBe(
      'Wrap-up',
    );
    expect(blockHelpText({ id: 'block-5', type: 'divider', style: 'line' })).toBe('');
  });

  it('reads a knowledge check as its prompt and options', () => {
    const check: Block = {
      id: 'block-6',
      type: 'knowledge_check',
      allowRetry: true,
      question: {
        id: 'question-1',
        type: 'single_choice',
        prompt: richText('What do you say first?'),
        points: 1,
        options: [
          { id: 'option-1', text: 'Your name', correct: true },
          { id: 'option-2', text: 'The price', correct: false },
        ],
      },
    };
    expect(blockHelpText(check)).toBe('What do you say first?\n\nYour name\n\nThe price');
  });

  it('cuts a selection only when it lies inside the text', () => {
    const all = blockHelpText(paragraph);
    expect(cutHelpSelection(all, { start: 0, end: 16 })).toBe('Greet the caller');
    expect(cutHelpSelection(all, { start: 37, end: all.length })).toBe(
      'Ask how you can help today.',
    );
    expect(cutHelpSelection(all, { start: 0, end: all.length + 1 })).toBeNull();
    expect(cutHelpSelection(all, { start: 5, end: 5 })).toBeNull();
  });
});

describe('Learning help requests', () => {
  it('needs a tone for Change tone, and only for it', () => {
    expect(HelpWriteRequestSchema.safeParse(request).success).toBe(true);
    expect(HelpWriteRequestSchema.safeParse({ ...request, tone: 'friendly' }).success).toBe(false);
    expect(HelpWriteRequestSchema.safeParse({ ...request, action: 'change_tone' }).success).toBe(
      false,
    );
    expect(
      HelpWriteRequestSchema.safeParse({ ...request, action: 'change_tone', tone: 'direct' })
        .success,
    ).toBe(true);
  });

  it('takes a selection as offsets only, with the end after the start', () => {
    const ok = HelpWriteRequestSchema.safeParse({ ...request, selection: { start: 2, end: 9 } });
    expect(ok.success).toBe(true);
    for (const selection of [
      { start: 9, end: 2 },
      { start: 4, end: 4 },
      { start: -1, end: 3 },
    ]) {
      expect(HelpWriteRequestSchema.safeParse({ ...request, selection }).success).toBe(false);
    }
    const withText = { ...request, selection: { start: 0, end: 4, text: 'Greet' } };
    expect(HelpWriteRequestSchema.parse(withText).selection).toEqual({ start: 0, end: 4 });
  });
});

describe('Learning help prompts', () => {
  it('names what to work on and asks for plain text, with no course text in the instruction', () => {
    const whole = helpWritePrompt('improve', undefined, false);
    expect(whole.system).toBe(HELP_SYSTEM);
    expect(whole.instruction).toContain('the block text');
    expect(whole.instruction).toContain('plain text');
    expect(helpWritePrompt('shorter', undefined, true).instruction).toContain('the selection');
    for (const tone of HELP_TONES) {
      expect(helpWritePrompt('change_tone', tone, false).instruction).toContain(
        HELP_TONE_LABELS[tone].toLowerCase(),
      );
    }
  });

  it('tidies answers: line endings, a code fence or quotes around it, extra blank lines', () => {
    expect(helpAnswerText('  Say hello.\r\n\r\n\r\nThen listen.  ')).toBe(
      'Say hello.\n\nThen listen.',
    );
    expect(helpAnswerText('```text\nSay hello.\n```')).toBe('Say hello.');
    expect(helpAnswerText('"Say hello."')).toBe('Say hello.');
    expect(helpAnswerText('"Say hello," she said, "then listen."')).toBe(
      '"Say hello," she said, "then listen."',
    );
    expect(helpAnswerText('```\n```')).toBe('');
  });
});
