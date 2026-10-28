import {
  addQuestion,
  deleteQuestion,
  duplicateQuestion,
  LIMITS,
  moveQuestion,
  updateQuestion,
} from '@carehub/learning';
import type { Course, Id, QuizLesson } from '@carehub/learning';
import { QuestionList } from '../editors/questions/QuestionList';
import { editQuiz } from './edit';

/** Props for {@link QuizQuestions}. */
export type QuizQuestionsProps = {
  lesson: QuizLesson;
  onChange(next: QuizLesson): void;
  course?: Course;
};

/** A quiz's own questions (surveys: single and multiple answer only), up to 200. */
export function QuizQuestions({ lesson, onChange, course }: QuizQuestionsProps) {
  const edit = (change: (course: Course, lessonId: Id) => Course) =>
    onChange(editQuiz(lesson, course, change));
  return (
    <QuestionList
      questions={lesson.questions}
      max={LIMITS.questions}
      survey={lesson.settings.mode === 'survey'}
      course={course}
      onAdd={(question) => edit((c, lessonId) => addQuestion(c, lessonId, question))}
      onUpdate={(id, next) => edit((c) => updateQuestion(c, id, () => next))}
      onCopy={(id) => edit((c) => duplicateQuestion(c, id))}
      onMove={(id, to) => edit((c) => moveQuestion(c, id, to))}
      onRemove={(id) => edit((c) => deleteQuestion(c, id))}
    />
  );
}
