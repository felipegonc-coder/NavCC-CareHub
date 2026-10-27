import { describe, expect, it } from 'vitest';
import { presetFor, richText, type Question, type QuizLesson } from '../format/index';
import { summarizeSurvey, type SurveySubmission } from './index';

// Fictional content only.
const rating: Question = {
  id: 'rating',
  type: 'single_choice',
  prompt: richText('How useful was the course?', 'Pick one.'),
  points: 1,
  options: [
    { id: 'very', text: 'Very useful', correct: false },
    { id: 'some', text: 'Somewhat useful', correct: false },
    { id: 'not', text: 'Not useful', correct: false },
  ],
};
const topics: Question = {
  id: 'topics',
  type: 'multiple_choice',
  prompt: richText('Which topics should we add?'),
  points: 1,
  options: [
    { id: 'billing', text: 'Billing', correct: false },
    { id: 'returns', text: 'Returns', correct: false },
  ],
};
const drawn: Question = { ...rating, id: 'pace', prompt: richText('Was the pace right?') };

const survey: QuizLesson = {
  id: 'feedback',
  kind: 'quiz',
  title: 'Course feedback',
  settings: { ...presetFor('standard').quiz, mode: 'survey' },
  questions: [rating, topics],
  bankDraws: [{ bankId: 'bank-feedback', count: 1, questions: [drawn, rating] }],
};
const submission = (...results: [string, string[], boolean?][]): SurveySubmission => ({
  results: results.map(([questionId, picked, answered]) =>
    answered === undefined ? { questionId, picked } : { questionId, picked, answered },
  ),
});

describe('summarizeSurvey', () => {
  it('counts answers per question, with whole percents of those who answered', () => {
    const summary = summarizeSurvey(survey, [
      submission(['rating', ['very']], ['topics', ['billing', 'returns']], ['pace', ['some']]),
      submission(['rating', ['very']], ['topics', ['billing']]),
      submission(['rating', ['not']], ['topics', [], false]),
    ]);
    expect(summary).toEqual({
      lessonId: 'feedback',
      submissions: 3,
      questions: [
        {
          questionId: 'rating',
          type: 'single_choice',
          prompt: 'How useful was the course?\nPick one.',
          answered: 3,
          answers: [
            { optionId: 'very', text: 'Very useful', count: 2, percent: 67 },
            { optionId: 'some', text: 'Somewhat useful', count: 0, percent: 0 },
            { optionId: 'not', text: 'Not useful', count: 1, percent: 33 },
          ],
        },
        {
          questionId: 'topics',
          type: 'multiple_choice',
          prompt: 'Which topics should we add?',
          answered: 2,
          answers: [
            { optionId: 'billing', text: 'Billing', count: 2, percent: 100 },
            { optionId: 'returns', text: 'Returns', count: 1, percent: 50 },
          ],
        },
        {
          questionId: 'pace',
          type: 'single_choice',
          prompt: 'Was the pace right?',
          answered: 1,
          answers: [
            { optionId: 'very', text: 'Very useful', count: 0, percent: 0 },
            { optionId: 'some', text: 'Somewhat useful', count: 1, percent: 100 },
            { optionId: 'not', text: 'Not useful', count: 0, percent: 0 },
          ],
        },
      ],
    });
  });

  it('gives null percents when nobody answered', () => {
    const summary = summarizeSurvey(survey, []);
    expect(summary.submissions).toBe(0);
    expect(summary.questions.map((question) => question.answered)).toEqual([0, 0, 0]);
    expect(
      summary.questions[0]?.answers.every(
        (answer) => answer.count === 0 && answer.percent === null,
      ),
    ).toBe(true);
  });

  it('ignores unknown questions and options, repeated picks and repeated results', () => {
    const summary = summarizeSurvey(survey, [
      submission(
        ['rating', ['very', 'very', 'nope']],
        ['rating', ['not']],
        ['elsewhere', ['very']],
      ),
      submission(['topics', []]),
    ]);
    const counts = summary.questions.map((question) => [
      question.answered,
      question.answers.map((answer) => answer.count),
    ]);
    expect(counts).toEqual([
      [1, [1, 0, 0]],
      [0, [0, 0]],
      [0, [0, 0, 0]],
    ]);
  });

  it('reads scored survey attempts as they are', () => {
    const result = (questionId: string, picked: string[]) => ({
      questionId,
      answered: true,
      correct: false,
      earned: 0,
      max: 0,
      fraction: 0,
      feedback: null,
      picked,
    });
    const attempt = {
      attemptId: 'attempt-1',
      results: [result('rating', ['some']), result('topics', ['returns'])],
      earned: 0,
      max: 0,
      percent: 0,
      passed: false,
    };
    const summary = summarizeSurvey(survey, [attempt]);
    expect(
      summary.questions.map((question) => question.answers.map((answer) => answer.count)),
    ).toEqual([
      [0, 1, 0],
      [0, 1],
      [0, 0, 0],
    ]);
  });

  it('counts answers without options for other question types', () => {
    const check: Question = {
      id: 'tf',
      type: 'true_false',
      prompt: richText('Returns take a week.'),
      points: 1,
      answer: true,
    };
    const summary = summarizeSurvey({ id: 'quiz', questions: [check] }, [
      submission(['tf', ['true']]),
    ]);
    expect(summary.questions).toEqual([
      {
        questionId: 'tf',
        type: 'true_false',
        prompt: 'Returns take a week.',
        answered: 1,
        answers: [],
      },
    ]);
  });
});
