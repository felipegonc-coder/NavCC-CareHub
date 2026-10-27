import { describe, expect, it } from 'vitest';
import { QuizLessonSchema } from '../format/index';
import { questionAnalysis, type AnalysedAttempt } from './index';

// A fictional hand-hygiene quiz with one question of each type that has picks, plus a bank draw.
const prompt = (text: string) => [{ runs: [{ text }] }];
const option = (id: string, text: string, correct = false) => ({ id, text, correct });
const spot = (id: string, label: string, correct = false) => ({
  id,
  label,
  correct,
  shape: 'rect',
  x: 10,
  y: 10,
  width: 20,
  height: 20,
});
const quiz = QuizLessonSchema.parse({
  id: 'l-check',
  kind: 'quiz',
  title: 'Hand hygiene check',
  settings: {
    passMark: 80,
    maxAttempts: null,
    shuffleQuestions: false,
    shuffleOptions: false,
    revealAnswers: 'after_each_attempt',
  },
  questions: [
    {
      id: 'q-moments',
      type: 'single_choice',
      prompt: prompt('When should you clean your hands?'),
      options: [
        option('a', 'Before touching a resident', true),
        option('b', 'Only at the end of a shift'),
        option('c', 'Only when they look dirty'),
      ],
    },
    {
      id: 'q-steps',
      type: 'multiple_choice',
      prompt: [
        {
          runs: [
            { text: 'Which steps are ' },
            { text: 'part', marks: ['bold'] },
            { text: ' of hand washing?' },
          ],
        },
      ],
      options: [
        option('s1', 'Wet your hands', true),
        option('s2', 'Rub for 20 seconds', true),
        option('s3', 'Dry on a shared towel'),
        option('s4', 'Skip the thumbs'),
      ],
    },
    {
      id: 'q-gloves',
      type: 'true_false',
      prompt: prompt('Gloves replace hand washing.'),
      answer: false,
    },
    {
      id: 'q-match',
      type: 'matching',
      prompt: prompt('Match each method to when to use it.'),
      pairs: [
        { id: 'p1', prompt: 'Soap and water', match: 'Visibly dirty hands' },
        { id: 'p2', prompt: 'Alcohol rub', match: 'Hands that look clean' },
        { id: 'p3', prompt: 'Gloves', match: 'Contact with body fluids' },
      ],
    },
    {
      id: 'q-spot',
      type: 'hotspot',
      prompt: prompt('Tap where you wash your hands.'),
      image: { media: { kind: 'file', fileId: 'img-ward-sink' }, alt: 'A ward corridor' },
      spots: [spot('sp1', 'Sink', true), spot('sp2', 'Door handle'), spot('sp3', 'Bin')],
    },
    {
      id: 'q-order',
      type: 'ordering',
      prompt: prompt('Put the steps in order.'),
      items: [
        { id: 'o1', text: 'Wet' },
        { id: 'o2', text: 'Rub' },
      ],
    },
    {
      id: 'q-fill',
      type: 'fill_blank',
      prompt: prompt('Fill in the gap.'),
      parts: [
        { kind: 'text', text: 'Rub for ' },
        { kind: 'blank', id: 'b1', answers: ['20'] },
      ],
    },
  ],
  bankDraws: [
    {
      bankId: 'bank-hygiene',
      count: 1,
      questions: [
        {
          id: 'q-bank',
          type: 'single_choice',
          prompt: prompt('How long should a hand rub last?'),
          options: [option('x1', '20 seconds', true), option('x2', '2 seconds')],
        },
        {
          id: 'q-gloves',
          type: 'true_false',
          prompt: prompt('A copy of a lesson question.'),
          answer: true,
        },
      ],
    },
    { bankId: 'bank-draft', count: 2 },
  ],
});

type Result = AnalysedAttempt['results'][number];
const results = (
  questionId: string,
  count: number,
  correct: boolean,
  picked: string[] = [],
  answered = true,
): Result[] => Array.from({ length: count }, () => ({ questionId, correct, picked, answered }));
const attempts: AnalysedAttempt[] = [
  {
    results: [
      ...results('q-moments', 7, true, ['a']),
      ...results('q-moments', 2, false, ['b']),
      ...results('q-moments', 1, false, ['c']),
    ],
  },
  {
    results: [
      ...results('q-steps', 5, true, ['s1', 's2']),
      ...results('q-steps', 3, false, ['s1', 's3']),
      ...results('q-steps', 1, false, ['s1', 's2', 's4']),
      ...results('q-steps', 1, false, ['s3', 's4']),
    ],
  },
  {
    results: [
      ...results('q-gloves', 6, true, ['false']),
      ...results('q-gloves', 4, false, ['true']),
    ],
  },
  {
    results: [
      ...results('q-match', 8, true, ['p1', 'p2', 'p3']),
      ...results('q-match', 1, false, ['p2', 'p1', 'p3']),
      ...results('q-match', 1, false, ['p1', 'p3', 'p2']),
    ],
  },
  {
    results: [
      ...results('q-spot', 4, true, ['sp1']),
      ...results('q-spot', 3, false, ['sp2']),
      ...results('q-spot', 1, false, ['sp3']),
    ],
  },
  { results: [...results('q-order', 9, true), ...results('q-order', 1, false, [], false)] },
  { results: [...results('q-bank', 2, false, ['x2']), ...results('q-ghost', 3, false, ['zz'])] },
];

describe('questionAnalysis', () => {
  const analysis = questionAnalysis(quiz, attempts);
  const entry = (id: string) => analysis.find((item) => item.questionId === id);

  it('puts the most-missed questions first: lowest percent correct, then most answered, unanswered last', () => {
    expect(analysis.map((item) => [item.questionId, item.percentCorrect, item.answered])).toEqual([
      ['q-bank', 0, 2],
      ['q-steps', 50, 10],
      ['q-spot', 50, 8],
      ['q-gloves', 60, 10],
      ['q-moments', 70, 10],
      ['q-match', 80, 10],
      ['q-order', 100, 9],
      ['q-fill', null, 0],
    ]);
  });

  it('ranks wrong picks by count with the option, spot or true/false text', () => {
    expect(entry('q-moments')).toEqual({
      questionId: 'q-moments',
      type: 'single_choice',
      prompt: 'When should you clean your hands?',
      answered: 10,
      correct: 7,
      percentCorrect: 70,
      wrongPicks: [
        { id: 'b', text: 'Only at the end of a shift', count: 2 },
        { id: 'c', text: 'Only when they look dirty', count: 1 },
      ],
    });
    expect(entry('q-steps')?.wrongPicks).toEqual([
      { id: 's3', text: 'Dry on a shared towel', count: 4 },
      { id: 's4', text: 'Skip the thumbs', count: 2 },
    ]);
    expect(entry('q-spot')?.wrongPicks).toEqual([
      { id: 'sp2', text: 'Door handle', count: 3 },
      { id: 'sp3', text: 'Bin', count: 1 },
    ]);
    expect(entry('q-gloves')?.wrongPicks).toEqual([{ id: 'true', text: 'True', count: 4 }]);
  });

  it('names wrong matches by prompt and chosen match, in question order on ties', () => {
    expect(entry('q-match')?.wrongPicks).toEqual([
      { id: 'p1>p2', text: 'Soap and water → Hands that look clean', count: 1 },
      { id: 'p2>p1', text: 'Alcohol rub → Visibly dirty hands', count: 1 },
      { id: 'p2>p3', text: 'Alcohol rub → Contact with body fluids', count: 1 },
      { id: 'p3>p2', text: 'Gloves → Hands that look clean', count: 1 },
    ]);
  });

  it("covers drawn bank questions once each, keeps the lesson's own copy and flattens rich text", () => {
    expect(entry('q-bank')?.wrongPicks).toEqual([{ id: 'x2', text: '2 seconds', count: 2 }]);
    expect(analysis.filter((item) => item.questionId === 'q-gloves')).toHaveLength(1);
    expect(entry('q-gloves')?.prompt).toBe('Gloves replace hand washing.');
    expect(entry('q-steps')?.prompt).toBe('Which steps are part of hand washing?');
  });

  it('leaves survey-mode quizzes to the survey results', () => {
    const survey = { ...quiz, settings: { ...quiz.settings, mode: 'survey' as const } };
    expect(questionAnalysis(survey, attempts)).toEqual([]);
    expect(
      questionAnalysis(
        { ...quiz, settings: { ...quiz.settings, mode: 'graded' as const } },
        attempts,
      ),
    ).toEqual(analysis);
  });

  it('skips unanswered results and unknown questions, and is safe without attempts', () => {
    expect(entry('q-order')).toMatchObject({ answered: 9, correct: 9, wrongPicks: [] });
    expect(entry('q-ghost')).toBeUndefined();
    const empty = questionAnalysis({ questions: quiz.questions }, []);
    expect(empty.map((item) => item.percentCorrect)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(empty.map((item) => item.questionId)).toEqual(
      quiz.questions.map((question) => question.id),
    );
  });
});
