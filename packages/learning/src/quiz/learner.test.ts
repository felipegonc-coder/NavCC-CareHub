import { describe, expect, it } from 'vitest';
import type { ContentLesson, Course, Question, QuizLesson, RichText } from '../format/index';
import { createCourse } from '../format/index';
import { sampleCourses } from '../fixtures/index';
import { LearnerCourseSchema, learnerCourse, planAttempt, plannedQuestionCount } from './index';

// Fictional content only.
const rt = (text: string): RichText => [{ runs: [{ text }] }];
const SEEDS = Array.from({ length: 30 }, (_, i) => i * 104729 + 7);

const trueFalse = (id: string): Question => ({
  id,
  type: 'true_false',
  prompt: rt(`Fictional statement ${id}`),
  points: 1,
  answer: true,
  feedbackTrue: rt('Right.'),
});
const own = ['q1', 'q2', 'q3', 'q4', 'q5'].map(trueFalse);
const bank = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => trueFalse(`${prefix}${i + 1}`));

const reading: ContentLesson = {
  id: 'lesson-read',
  kind: 'content',
  title: 'Refund basics',
  blocks: [{ id: 'kc-1', type: 'knowledge_check', allowRetry: true, question: trueFalse('kc-q') }],
};
const graded: QuizLesson = {
  id: 'quiz-final',
  kind: 'quiz',
  title: 'Refunds check',
  intro: rt('Ten minutes, three tries.'),
  settings: {
    passMark: 80,
    maxAttempts: 3,
    shuffleQuestions: true,
    shuffleOptions: true,
    poolSize: 3,
    revealAnswers: 'after_passing',
  },
  questions: own,
  bankDraws: [
    { bankId: 'bank-billing', count: 2, questions: bank('b', 4) },
    { bankId: 'bank-privacy', count: 5, questions: bank('p', 3) },
    { bankId: 'bank-draft', count: 4 },
  ],
};
const survey: QuizLesson = {
  id: 'quiz-survey',
  kind: 'quiz',
  title: 'How did it go?',
  settings: {
    passMark: 0,
    maxAttempts: 1,
    shuffleQuestions: false,
    shuffleOptions: false,
    revealAnswers: 'never',
    mode: 'survey',
  },
  questions: [trueFalse('s1'), trueFalse('s2')],
};
const course: Course = {
  ...createCourse({ type: 'standard', title: 'Pinecrest Wireless refunds', id: 'course-refunds' }),
  lessons: [reading, graded, survey],
};

describe('learnerCourse', () => {
  it('keeps id, title, intro, settings and a question count of every quiz lesson, and nothing else', () => {
    const lessons = learnerCourse(course).lessons;
    expect(lessons[1]).toStrictEqual({
      id: 'quiz-final',
      kind: 'quiz',
      title: 'Refunds check',
      intro: graded.intro,
      settings: graded.settings,
      questionCount: 8,
    });
    expect(lessons[2]).toStrictEqual({
      id: 'quiz-survey',
      kind: 'quiz',
      title: 'How did it go?',
      settings: survey.settings,
      questionCount: 2,
    });
  });

  it('counts the questions each attempt shows, whatever the seed', () => {
    // poolSize 3 of 5, then 2 of 4 and all 3 of a draw asking for 5; the draft draw adds none.
    expect(plannedQuestionCount(graded)).toBe(8);
    for (const seed of SEEDS) expect(planAttempt(graded, seed, 'att').questionIds).toHaveLength(8);
    expect(plannedQuestionCount({ ...graded, settings: { ...graded.settings, poolSize: 9 } })).toBe(
      10,
    );
    expect(plannedQuestionCount({ ...graded, questions: [], bankDraws: [] })).toBe(0);
  });

  it('keeps content lessons as they are: knowledge checks are practice', () => {
    const result = learnerCourse(course);
    expect(result.lessons[0]).toBe(reading);
    expect({ ...result, lessons: [] }).toEqual({ ...course, lessons: [] });
  });

  it('passes LearnerCourseSchema, which refuses quiz questions and bank draws', () => {
    const result = learnerCourse(course);
    expect(LearnerCourseSchema.safeParse(JSON.parse(JSON.stringify(result))).data).toEqual(result);
    const withQuiz = (extra: Record<string, unknown>) => ({
      ...result,
      lessons: [{ ...result.lessons[1], ...extra }],
    });
    expect(LearnerCourseSchema.safeParse(withQuiz({ questions: own })).success).toBe(false);
    expect(LearnerCourseSchema.safeParse(withQuiz({ bankDraws: graded.bankDraws })).success).toBe(
      false,
    );
    expect(LearnerCourseSchema.safeParse({ ...result, lessons: [graded] }).success).toBe(false);
  });

  it('works on every sample course', () => {
    for (const sample of sampleCourses) {
      const result = learnerCourse(sample);
      expect(LearnerCourseSchema.safeParse(result).success).toBe(true);
      sample.lessons.forEach((lesson, index) => {
        const learnerLesson = result.lessons[index];
        if (lesson.kind === 'content') {
          expect(learnerLesson).toBe(lesson);
        } else {
          expect(JSON.stringify(learnerLesson)).not.toContain('"correct"');
          expect(learnerLesson).toMatchObject({
            questionCount: planAttempt(lesson, 1, 'att').questionIds.length,
          });
        }
      });
    }
  });

  it("doesn't change the course", () => {
    const before = JSON.stringify(course);
    learnerCourse(course);
    expect(JSON.stringify(course)).toBe(before);
  });
});
