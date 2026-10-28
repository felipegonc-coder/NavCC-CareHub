import {
  blockAnchorId,
  type Course,
  type CreateReviewCommentRequest,
  type LearnerCourseState,
  type Lesson,
  type Link,
  type ReviewComment,
} from '@carehub/learning';
import { useId } from 'react';
import { BlockView } from '../blocks/registry';
import { RichTextView } from '../blocks/text';
import { CommentThread, type ReviewTarget } from './CommentThread';

/** The DOM id of a lesson on the review screen, for links to it. */
export const lessonAnchorId = (lessonId: string) => `lesson-${lessonId}`;

type ReviewLessonProps = {
  course: Course;
  lesson: Lesson;
  number: number;
  comments: readonly ReviewComment[];
  /** An empty learner state, as block views expect one. */
  state: LearnerCourseState;
  go(link: Link): void;
  send(input: CreateReviewCommentRequest): Promise<unknown>;
};

const ignore = () => {};

const on = (comments: readonly ReviewComment[], target: ReviewTarget) =>
  comments.filter(
    (comment) =>
      comment.lessonId === target.lessonId &&
      comment.blockId === target.blockId &&
      comment.questionId === target.questionId,
  );

/**
 * One lesson of the draft, read-only and in full: every block (or every quiz question), each with its comments and
 * a way to add one, and comments on the whole lesson.
 */
export function ReviewLesson(props: ReviewLessonProps) {
  const { course, lesson, number, comments, state, go, send } = props;
  const headingId = useId();
  const thread = (what: string, target: ReviewTarget) => (
    <CommentThread what={what} target={target} comments={on(comments, target)} send={send} />
  );
  return (
    <section
      id={lessonAnchorId(lesson.id)}
      aria-labelledby={headingId}
      className="flex flex-col gap-6 border-t border-border pt-8"
    >
      <h2 id={headingId} className="text-h2 text-fg">
        {`${number}. ${lesson.title}`}
      </h2>
      {thread('this lesson', { lessonId: lesson.id })}
      {lesson.kind === 'content'
        ? lesson.blocks.map((block) => (
            <div key={block.id} id={blockAnchorId(block.id)} className="flex flex-col gap-3">
              <BlockView
                block={block}
                lesson={lesson}
                course={course}
                mode="review"
                state={state}
                emit={ignore}
                go={go}
              />
              {thread('this block', { lessonId: lesson.id, blockId: block.id })}
            </div>
          ))
        : [
            <RichTextView key="intro" value={lesson.intro} course={course} go={go} />,
            ...lesson.questions.map((question, index) => (
              <div key={question.id} className="flex flex-col gap-3">
                <h3 className="text-h3 text-fg">{`Question ${index + 1}`}</h3>
                <RichTextView value={question.prompt} course={course} go={go} />
                {thread(`question ${index + 1}`, { lessonId: lesson.id, questionId: question.id })}
              </div>
            )),
          ]}
    </section>
  );
}
