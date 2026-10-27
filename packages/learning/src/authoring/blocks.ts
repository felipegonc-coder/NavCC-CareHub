import { LIMITS, allQuestions } from '../format/index';
import type { Block, ContentLesson, Course, Id, Question } from '../format/index';
import { clampIndex, insertItem, moveItemById, removeItemById, updateItemById } from './arrays';
import { blockIds, courseIds, uniqueIds, withFreeIds, withFreshIds } from './ids';
import { updateLesson } from './lessons';
import type { IdGen } from './types';

/** Where a block lives: its content lesson and position. */
export type BlockLocation = { lesson: ContentLesson; index: number; block: Block };

/** Finds a block anywhere in the course, or null. */
export function locateBlock(course: Course, blockId: Id): BlockLocation | null {
  for (const lesson of course.lessons) {
    if (lesson.kind !== 'content') continue;
    const index = lesson.blocks.findIndex((block) => block.id === blockId);
    const block = lesson.blocks[index];
    if (block) return { lesson, index, block };
  }
  return null;
}

function setBlocks(course: Course, lessonId: Id, update: (blocks: Block[]) => Block[]): Course {
  return updateLesson(course, lessonId, (lesson) => {
    if (lesson.kind !== 'content') return lesson;
    const blocks = update(lesson.blocks);
    return blocks === lesson.blocks ? lesson : { ...lesson, blocks };
  });
}

const isFull = (lesson: ContentLesson): boolean => lesson.blocks.length >= LIMITS.blocks;

/**
 * Adds blocks (from `newBlock`, a paste or a block template) to a content lesson at `index` (default: the end),
 * as many as fit in the 300-block limit. Ids already in use are replaced.
 */
export function addBlocks(
  course: Course,
  lessonId: Id,
  blocks: readonly Block[],
  index?: number,
  newId?: IdGen,
): Course {
  const lesson = course.lessons.find((l) => l.id === lessonId);
  if (lesson?.kind !== 'content' || blocks.length === 0 || isFull(lesson)) return course;
  const taken = courseIds(course);
  const added = blocks.slice(0, LIMITS.blocks - lesson.blocks.length).map((block) => {
    const safe = withFreeIds(block, blockIds(block), taken, newId);
    for (const id of blockIds(safe)) taken.add(id);
    return safe;
  });
  return setBlocks(course, lessonId, (list) => {
    const at = clampIndex(index ?? list.length, list.length);
    return [...list.slice(0, at), ...added, ...list.slice(at)];
  });
}

/** Adds one block to a content lesson at `index` (default: the end). */
export function addBlock(
  course: Course,
  lessonId: Id,
  block: Block,
  index?: number,
  newId?: IdGen,
): Course {
  return addBlocks(course, lessonId, [block], index, newId);
}

/** Replaces a block by `update(block)` (the properties form). */
export function updateBlock(course: Course, blockId: Id, update: (block: Block) => Block): Course {
  const at = locateBlock(course, blockId);
  return at
    ? setBlocks(course, at.lesson.id, (blocks) => updateItemById(blocks, blockId, update))
    : course;
}

/** Copies a block right below itself, with fresh ids. */
export function duplicateBlock(course: Course, blockId: Id, newId?: IdGen): Course {
  const at = locateBlock(course, blockId);
  if (!at || isFull(at.lesson)) return course;
  const copy = withFreshIds(at.block, blockIds(at.block), uniqueIds(courseIds(course), newId));
  return setBlocks(course, at.lesson.id, (blocks) => insertItem(blocks, at.index + 1, copy));
}

/** Deletes a block. */
export function deleteBlock(course: Course, blockId: Id): Course {
  const at = locateBlock(course, blockId);
  return at ? setBlocks(course, at.lesson.id, (blocks) => removeItemById(blocks, blockId)) : course;
}

/** Moves a block within its lesson so it ends up at `toIndex` (drag and drop). */
export function moveBlock(course: Course, blockId: Id, toIndex: number): Course {
  const at = locateBlock(course, blockId);
  return at
    ? setBlocks(course, at.lesson.id, (blocks) => moveItemById(blocks, blockId, toIndex))
    : course;
}

/** Moves a block up (-1) or down (+1) within its lesson. */
export function moveBlockBy(course: Course, blockId: Id, delta: number): Course {
  const at = locateBlock(course, blockId);
  return at ? moveBlock(course, blockId, at.index + delta) : course;
}

/** Moves a block to another content lesson, at `index` (default: the end). */
export function moveBlockToLesson(
  course: Course,
  blockId: Id,
  lessonId: Id,
  index?: number,
): Course {
  const at = locateBlock(course, blockId);
  const target = course.lessons.find((l) => l.id === lessonId);
  if (!at || target?.kind !== 'content' || target.id === at.lesson.id || isFull(target))
    return course;
  const without = setBlocks(course, at.lesson.id, (blocks) => removeItemById(blocks, blockId));
  return setBlocks(without, lessonId, (blocks) =>
    insertItem(blocks, index ?? blocks.length, at.block),
  );
}

const findQuestion = (course: Course, questionId: Id) =>
  allQuestions(course).find((at) => at.question.id === questionId);

function setQuestions(
  course: Course,
  lessonId: Id,
  update: (questions: Question[]) => Question[],
): Course {
  return updateLesson(course, lessonId, (lesson) => {
    if (lesson.kind !== 'quiz') return lesson;
    const questions = update(lesson.questions);
    return questions === lesson.questions ? lesson : { ...lesson, questions };
  });
}

/** Adds a question (from `newQuestion`) to a quiz lesson at `index` (default: the end), up to 200. */
export function addQuestion(
  course: Course,
  lessonId: Id,
  question: Question,
  index?: number,
  newId?: IdGen,
): Course {
  const lesson = course.lessons.find((l) => l.id === lessonId);
  if (lesson?.kind !== 'quiz' || lesson.questions.length >= LIMITS.questions) return course;
  const safe = withFreeIds(question, [question.id], courseIds(course), newId);
  return setQuestions(course, lessonId, (questions) =>
    insertItem(questions, index ?? questions.length, safe),
  );
}

/** Replaces a question, in a quiz or a knowledge check, by `update(question)`. Bank-draw copies are left alone. */
export function updateQuestion(
  course: Course,
  questionId: Id,
  update: (question: Question) => Question,
): Course {
  const at = findQuestion(course, questionId);
  if (at?.where === 'quiz')
    return setQuestions(course, at.lessonId, (qs) => updateItemById(qs, questionId, update));
  if (at?.where !== 'knowledge_check') return course;
  return updateBlock(course, at.blockId, (block) => {
    if (block.type !== 'knowledge_check') return block;
    const question = update(block.question);
    return question === block.question ? block : { ...block, question };
  });
}

/** Copies a quiz question right after itself, with a fresh id. */
export function duplicateQuestion(course: Course, questionId: Id, newId?: IdGen): Course {
  const at = findQuestion(course, questionId);
  const lesson = course.lessons[at?.lessonIndex ?? -1];
  if (
    at?.where !== 'quiz' ||
    lesson?.kind !== 'quiz' ||
    lesson.questions.length >= LIMITS.questions
  )
    return course;
  const copy = withFreshIds(at.question, [questionId], uniqueIds(courseIds(course), newId));
  return setQuestions(course, at.lessonId, (qs) => insertItem(qs, at.questionIndex + 1, copy));
}

/** Deletes a quiz question (a knowledge check is deleted with its block). */
export function deleteQuestion(course: Course, questionId: Id): Course {
  const at = findQuestion(course, questionId);
  return at?.where === 'quiz'
    ? setQuestions(course, at.lessonId, (qs) => removeItemById(qs, questionId))
    : course;
}

/** Moves a quiz question so it ends up at `toIndex`. */
export function moveQuestion(course: Course, questionId: Id, toIndex: number): Course {
  const at = findQuestion(course, questionId);
  return at?.where === 'quiz'
    ? setQuestions(course, at.lessonId, (qs) => moveItemById(qs, questionId, toIndex))
    : course;
}
