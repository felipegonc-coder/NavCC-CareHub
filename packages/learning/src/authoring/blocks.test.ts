import { describe, expect, it } from 'vitest';
import { CourseSchema, LIMITS, allQuestions, presetFor } from '../format/index';
import type { Block, Course, Question } from '../format/index';
import {
  addBlock,
  addBlocks,
  addQuestion,
  deleteBlock,
  deleteQuestion,
  duplicateBlock,
  duplicateQuestion,
  locateBlock,
  moveBlock,
  moveBlockBy,
  moveBlockToLesson,
  moveQuestion,
  updateBlock,
  updateQuestion,
} from './blocks';
import { courseIds } from './ids';

const counter = (prefix = 'n') => {
  let n = 0;
  return () => `${prefix}${++n}`;
};

const heading = (id: string, text = 'Hello'): Block => ({ id, type: 'heading', level: 2, text });
const trueFalse = (id: string): Question => ({
  id,
  type: 'true_false',
  prompt: [{ runs: [{ text: 'Smile when you answer.' }] }],
  points: 1,
  answer: true,
});

// A small fictional course: two content lessons and a quiz.
const make = (blocks: Block[] = [heading('b1'), heading('b2'), heading('b3')]): Course => ({
  formatVersion: 1,
  id: 'c1',
  title: 'Calm conversations',
  type: 'standard',
  settings: presetFor('standard').settings,
  lessons: [
    { id: 'l1', kind: 'content', title: 'Listen first', blocks },
    {
      id: 'l2',
      kind: 'content',
      title: 'Reply',
      blocks: [{ id: 'kc', type: 'knowledge_check', allowRetry: true, question: trueFalse('kq') }],
    },
    {
      id: 'q',
      kind: 'quiz',
      title: 'Quiz',
      settings: presetFor('standard').quiz,
      questions: [trueFalse('q1'), trueFalse('q2')],
    },
  ],
});

const expectValid = (course: Course) => expect(CourseSchema.safeParse(course).success).toBe(true);
const blockIdsOf = (course: Course, lessonId: string) => {
  const lesson = course.lessons.find((l) => l.id === lessonId);
  return lesson?.kind === 'content' ? lesson.blocks.map((b) => b.id) : [];
};
const locateQuestion = (course: Course, id: string) =>
  allQuestions(course).find((at) => at.question.id === id) ?? null;
const questionIdsOf = (course: Course) =>
  course.lessons[2]?.kind === 'quiz' ? course.lessons[2].questions.map((q) => q.id) : [];

describe('adding blocks', () => {
  it('adds at a position or at the end', () => {
    const course = make();
    expect(blockIdsOf(addBlock(course, 'l1', heading('new'), 1), 'l1')).toEqual([
      'b1',
      'new',
      'b2',
      'b3',
    ]);
    expect(blockIdsOf(addBlock(course, 'l1', heading('new')), 'l1')).toEqual([
      'b1',
      'b2',
      'b3',
      'new',
    ]);
    expect(addBlock(course, 'q', heading('new'))).toBe(course);
  });

  it("replaces ids already in use, including a knowledge check's question id", () => {
    const course = make();
    const check: Block = {
      id: 'b1',
      type: 'knowledge_check',
      allowRetry: false,
      question: trueFalse('q1'),
    };
    const next = addBlocks(course, 'l1', [check, heading('b2'), heading('fresh')], 0, counter());
    expect(blockIdsOf(next, 'l1')).toEqual(['n1', 'n3', 'fresh', 'b1', 'b2', 'b3']);
    expect(locateBlock(next, 'n1')?.block).toMatchObject({ question: { id: 'n2' } });
    expect(courseIds(next).size).toBe(14);
    expectValid(next);
  });

  it('adds only as many blocks as fit in the lesson', () => {
    const course = make(Array.from({ length: LIMITS.blocks - 1 }, (_, i) => heading(`b${i}`)));
    const next = addBlocks(course, 'l1', [heading('x'), heading('y')]);
    expect(blockIdsOf(next, 'l1')).toHaveLength(LIMITS.blocks);
    expect(addBlock(next, 'l1', heading('z'))).toBe(next);
    expect(duplicateBlock(next, 'x')).toBe(next);
  });
});

describe('block edits', () => {
  it('updates, duplicates and deletes', () => {
    const course = make();
    const renamed = updateBlock(course, 'b2', (b) =>
      b.type === 'heading' ? { ...b, text: 'Breathe' } : b,
    );
    expect(locateBlock(renamed, 'b2')).toMatchObject({
      index: 1,
      lesson: { id: 'l1' },
      block: { text: 'Breathe' },
    });
    expect(updateBlock(course, 'b2', (b) => b)).toBe(course);
    const copied = duplicateBlock(make(), 'kc', counter());
    expect(blockIdsOf(copied, 'l2')).toEqual(['kc', 'n1']);
    expect(locateBlock(copied, 'n1')?.block).toMatchObject({ question: { id: 'n2' } });
    expectValid(copied);
    expect(blockIdsOf(deleteBlock(course, 'b2'), 'l1')).toEqual(['b1', 'b3']);
    expect(deleteBlock(course, 'missing')).toBe(course);
  });

  it('moves within a lesson and to another lesson', () => {
    const course = make();
    expect(blockIdsOf(moveBlock(course, 'b1', 2), 'l1')).toEqual(['b2', 'b3', 'b1']);
    expect(blockIdsOf(moveBlockBy(course, 'b3', -1), 'l1')).toEqual(['b1', 'b3', 'b2']);
    expect(moveBlockBy(course, 'b3', 1)).toBe(course);
    const moved = moveBlockToLesson(course, 'b2', 'l2', 0);
    expect(blockIdsOf(moved, 'l1')).toEqual(['b1', 'b3']);
    expect(blockIdsOf(moved, 'l2')).toEqual(['b2', 'kc']);
    expect(moveBlockToLesson(course, 'b2', 'q')).toBe(course);
    expect(moveBlockToLesson(course, 'b2', 'l1')).toBe(course);
  });
});

describe('questions', () => {
  it('adds, duplicates, moves and deletes quiz questions', () => {
    const course = make();
    const added = addQuestion(course, 'q', trueFalse('q1'), 0, counter());
    expect(questionIdsOf(added)).toEqual(['n1', 'q1', 'q2']);
    expect(addQuestion(course, 'l1', trueFalse('x'))).toBe(course);
    expect(questionIdsOf(duplicateQuestion(course, 'q1', counter()))).toEqual(['q1', 'n1', 'q2']);
    expect(duplicateQuestion(course, 'kq')).toBe(course);
    expect(questionIdsOf(moveQuestion(course, 'q1', 1))).toEqual(['q2', 'q1']);
    expect(questionIdsOf(deleteQuestion(course, 'q1'))).toEqual(['q2']);
    expect(deleteQuestion(course, 'kq')).toBe(course);
    expectValid(added);
  });

  it('updates a question wherever it lives', () => {
    const course = make();
    const flip = (q: Question): Question =>
      q.type === 'true_false' ? { ...q, answer: !q.answer } : q;
    expect(locateQuestion(updateQuestion(course, 'q2', flip), 'q2')?.question).toMatchObject({
      answer: false,
    });
    expect(locateQuestion(updateQuestion(course, 'kq', flip), 'kq')?.question).toMatchObject({
      answer: false,
    });
    expect(updateQuestion(course, 'kq', (q) => q)).toBe(course);
    expect(updateQuestion(course, 'missing', flip)).toBe(course);
  });
});
