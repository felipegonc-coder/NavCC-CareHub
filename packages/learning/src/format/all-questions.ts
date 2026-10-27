import type { KnowledgeCheckBlock } from './blocks';
import type { Course } from './course';
import type { Id } from './primitives';
import type { Question } from './questions';

/** A question and where it lives. `path` uses the same notation as format issues, e.g. `lessons[1].questions[0]`. */
export type QuestionLocation = {
  question: Question;
  lessonId: Id;
  lessonIndex: number;
  path: string;
} & (
  | { where: 'quiz'; questionIndex: number }
  | { where: 'bank_draw'; bankId: Id; drawIndex: number; questionIndex: number }
  | { where: 'knowledge_check'; blockId: Id; blockIndex: number }
);

/**
 * Every question in a course, in reading order: knowledge checks in content lessons, then for each quiz lesson
 * its own questions followed by the questions copied from its bank draws.
 */
export function allQuestions(course: Course): QuestionLocation[] {
  const out: QuestionLocation[] = [];
  course.lessons.forEach((lesson, lessonIndex) => {
    const at = { lessonId: lesson.id, lessonIndex };
    if (lesson.kind === 'content') {
      lesson.blocks.forEach((block, blockIndex) => {
        if (block.type !== 'knowledge_check') return;
        const check: KnowledgeCheckBlock = block;
        const path = `lessons[${lessonIndex}].blocks[${blockIndex}].question`;
        out.push({
          ...at,
          question: check.question,
          path,
          where: 'knowledge_check',
          blockId: check.id,
          blockIndex,
        });
      });
      return;
    }
    lesson.questions.forEach((question, questionIndex) => {
      out.push({
        ...at,
        question,
        path: `lessons[${lessonIndex}].questions[${questionIndex}]`,
        where: 'quiz',
        questionIndex,
      });
    });
    (lesson.bankDraws ?? []).forEach((draw, drawIndex) => {
      (draw.questions ?? []).forEach((question, questionIndex) => {
        const path = `lessons[${lessonIndex}].bankDraws[${drawIndex}].questions[${questionIndex}]`;
        out.push({
          ...at,
          question,
          path,
          where: 'bank_draw',
          bankId: draw.bankId,
          drawIndex,
          questionIndex,
        });
      });
    });
  });
  return out;
}
