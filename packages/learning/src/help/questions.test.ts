import { describe, expect, it } from 'vitest';
import { createCourse, presetFor, QuestionSchema, richText } from '../format/index';
import type { Course, Lesson } from '../format/index';
import { HelpQuestionsRequestSchema, HelpSummarySchema, type HelpQuestionDraft } from './api';
import { HELP_SYSTEM, helpQuestionsPrompt, helpSummaryPrompt } from './prompts';
import { helpQuestions } from './questions';
import { lessonHelpText } from './text';

// Fictional course text only.
const content: Lesson = {
  id: 'lesson-1',
  kind: 'content',
  title: 'Opening the call',
  blocks: [
    { id: 'block-1', type: 'heading', level: 2, text: 'Greeting' },
    { id: 'block-2', type: 'paragraph', text: [] },
    { id: 'block-3', type: 'paragraph', text: richText('Say your name and smile.') },
  ],
};
const course: Course = {
  ...createCourse({ type: 'standard', title: 'Billing calls' }),
  lessons: [content],
};

const counter = () => {
  let next = 0;
  return () => `new-${++next}`;
};

const choice = (
  type: 'single_choice' | 'multiple_choice',
  first: boolean,
  second: boolean,
): HelpQuestionDraft => ({
  type,
  prompt: 'What do you say first?',
  options: [
    { text: 'Your name', correct: first },
    { text: 'The price', correct: second },
  ],
});

describe('Learning help: lesson text', () => {
  it("reads a lesson's blocks, or a quiz's intro and questions, leaving out empty parts", () => {
    expect(lessonHelpText(content)).toBe('Greeting\n\nSay your name and smile.');
    const quiz: Lesson = {
      id: 'lesson-2',
      kind: 'quiz',
      title: 'Check',
      intro: richText('Two quick questions.'),
      settings: { ...presetFor('standard').quiz },
      questions: [
        {
          id: 'question-1',
          type: 'true_false',
          prompt: richText('You smile first.'),
          points: 1,
          answer: true,
        },
      ],
    };
    expect(lessonHelpText(quiz)).toBe('Two quick questions.\n\nYou smile first.');
  });
});

describe('Learning help: summary and question requests', () => {
  it('keeps summaries to short plain lines and at most 8 key points', () => {
    const summary = { summary: ' Greet callers well. ', keyPoints: ['Say your name.'] };
    expect(HelpSummarySchema.parse(summary).summary).toBe('Greet callers well.');
    expect(HelpSummarySchema.safeParse({ ...summary, keyPoints: [] }).success).toBe(false);
    expect(
      HelpSummarySchema.safeParse({ ...summary, keyPoints: Array(9).fill('Smile.') }).success,
    ).toBe(false);
    expect(HelpSummarySchema.safeParse({ ...summary, summary: 'x'.repeat(501) }).success).toBe(
      false,
    );
  });

  it('asks for 5 questions unless told otherwise, at most 10, of the three types', () => {
    const request = { courseId: 'course-1', revision: 2, lessonId: 'lesson-1' };
    expect(HelpQuestionsRequestSchema.parse(request).count).toBe(5);
    expect(HelpQuestionsRequestSchema.safeParse({ ...request, count: 11 }).success).toBe(false);
    expect(HelpQuestionsRequestSchema.safeParse({ ...request, types: ['ordering'] }).success).toBe(
      false,
    );
  });

  it('asks for JSON in plain text, with no course text in the instruction', () => {
    expect(helpSummaryPrompt('course').system).toBe(HELP_SYSTEM);
    expect(helpSummaryPrompt('course').instruction).toContain('each document is one lesson');
    const one = helpQuestionsPrompt(1, ['true_false']).instruction;
    expect(one).toContain('Write 1 quiz question that');
    expect(one).toContain('true or false');
    expect(one).not.toContain('single choice');
  });
});

describe('Learning help: questions from Claude', () => {
  it('turns drafts into course questions with fresh ids and the explanation as feedback', () => {
    const drafts: HelpQuestionDraft[] = [
      { ...choice('single_choice', true, false), explanation: 'You say who you are first.' },
      { type: 'true_false', prompt: 'You smile first.', answer: true },
    ];
    const questions = helpQuestions(course, drafts, counter());
    expect(questions).toEqual([
      {
        id: 'new-1',
        type: 'single_choice',
        prompt: richText('What do you say first?'),
        points: 1,
        feedback: {
          correct: richText('You say who you are first.'),
          incorrect: richText('You say who you are first.'),
        },
        options: [
          { id: 'new-2', text: 'Your name', correct: true },
          { id: 'new-3', text: 'The price', correct: false },
        ],
      },
      {
        id: 'new-4',
        type: 'true_false',
        prompt: richText('You smile first.'),
        points: 1,
        answer: true,
      },
    ]);
    for (const question of questions) expect(QuestionSchema.safeParse(question).success).toBe(true);
  });

  it('drops questions that fail the course checks', () => {
    const kept = helpQuestions(course, [
      choice('single_choice', true, true),
      choice('multiple_choice', false, false),
      choice('single_choice', false, true),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({
      type: 'single_choice',
      options: [{ correct: false }, { correct: true }],
    });
  });
});
