import { ASSISTANT_TEXTS } from '@carehub/extras/claude/assistant';
import { describe, expect, it } from 'vitest';
import { ASSISTANT_SYSTEM, HISTORY_CHARS, historyDocument, readAnswer } from './prompt';

describe('the assistant prompt', () => {
  it('asks for answers from the sources only, with the not-found sentence and numbered sources', () => {
    expect(ASSISTANT_SYSTEM).toContain('Answer from those sources only');
    expect(ASSISTANT_SYSTEM).toContain(ASSISTANT_TEXTS.notFound);
    expect(ASSISTANT_SYSTEM).toContain('"Sources: 1, 3"');
  });

  it('reads the sources line off the answer', () => {
    expect(readAnswer('Refunds take 3 working days.\n\nSources: 2, 1, 2', 3)).toEqual({
      text: 'Refunds take 3 working days.',
      cited: [2, 1],
      notFound: false,
    });
    expect(readAnswer('Three days.\n**Sources:** 1 and 3.', 2).cited).toEqual([1]);
    expect(readAnswer('Three days.\nSource: 9', 2)).toEqual({
      text: 'Three days.',
      cited: [],
      notFound: false,
    });
    expect(readAnswer('  Three days, see Sources 1 below.  ', 2)).toEqual({
      text: 'Three days, see Sources 1 below.',
      cited: null,
      notFound: false,
    });
  });

  it("knows Claude's not-found answer, however it's typed", () => {
    for (const text of [
      "I couldn't find that in the pages you can open.",
      'I couldn’t find that in the pages you can open',
      "I COULDN'T FIND THAT IN THE PAGES YOU CAN OPEN.\nSources: 1",
    ]) {
      expect(readAnswer(text, 1)).toMatchObject({ text: ASSISTANT_TEXTS.notFound, notFound: true });
    }
    expect(readAnswer("I couldn't find that in the pages you can open, but…", 1).notFound).toBe(
      false,
    );
  });

  it('sends the chat so far, newest turns first, leaving out answers it may not send', () => {
    expect(historyDocument([])).toBeNull();
    const history = historyDocument([
      { question: 'How long do refunds take?', answer: 'Three days.' },
      { question: 'Who signs off?', answer: null },
    ]);
    expect(history).toEqual({
      title: 'Earlier in this chat',
      text: 'Question: How long do refunds take?\nAnswer: Three days.\n\nQuestion: Who signs off?\nAnswer: (left out)',
    });
    const long = Array.from({ length: 10 }, (_, n) => ({
      question: `Question ${n}`,
      answer: 'x'.repeat(1_500),
    }));
    const kept = historyDocument(long);
    expect(kept?.text.length).toBeLessThanOrEqual(HISTORY_CHARS);
    expect(kept?.text.startsWith('Question: Question 5\n')).toBe(true);
    expect(kept?.text).toContain('Question 9');
  });
});
