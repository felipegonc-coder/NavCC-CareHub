import type { Block, ContentLesson, Course } from '../format/index';
import {
  ContentLessonSchema,
  checkPublishable,
  newId as randomId,
  richText,
} from '../format/index';
import type { HelpDraftLesson } from './api';

/** A fresh id for each new lesson, block and list item. */
type IdGen = () => string;

/** Plain text as rich text, one paragraph for each run of lines between blank lines. */
const paragraphs = (text: string) =>
  richText(
    ...text
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph !== ''),
  );

function toBlock(block: HelpDraftLesson['blocks'][number], newId: IdGen): Block {
  switch (block.type) {
    case 'heading':
      return { id: newId(), type: 'heading', level: 2, text: block.text };
    case 'paragraph':
      return { id: newId(), type: 'paragraph', text: paragraphs(block.text) };
    case 'list':
      return {
        id: newId(),
        type: 'list',
        style: block.style,
        items: block.items.map((item) => ({ id: newId(), text: richText(item) })),
      };
    case 'callout':
      return { id: newId(), type: 'callout', tone: block.tone, text: paragraphs(block.text) };
  }
}

/**
 * Claude's draft lessons as content lessons with fresh ids. Lessons that fail the format are left out; then the
 * normal publish checks run with the lessons in this course, and blocks or lessons with problems are left out.
 */
export function helpCourseDraft(
  course: Course,
  drafts: readonly HelpDraftLesson[],
  newId: IdGen = randomId,
): ContentLesson[] {
  const lessons = drafts
    .map((draft): ContentLesson => ({
      id: newId(),
      kind: 'content',
      title: draft.title,
      blocks: draft.blocks.map((block) => toBlock(block, newId)),
    }))
    .filter((lesson) => ContentLessonSchema.safeParse(lesson).success);
  const problems = checkPublishable({ ...course, lessons });
  const badBlocks = new Set(problems.map((problem) => problem.blockId));
  const badLessons = new Set(
    problems.filter((problem) => problem.blockId === undefined).map((problem) => problem.lessonId),
  );
  return lessons
    .filter((lesson) => !badLessons.has(lesson.id))
    .map((lesson) => ({ ...lesson, blocks: lesson.blocks.filter((b) => !badBlocks.has(b.id)) }))
    .filter((lesson) => lesson.blocks.length > 0);
}
