import {
  addQuestion,
  deleteQuestion,
  duplicateQuestion,
  LIMITS,
  moveQuestion,
  newQuestion,
  questionCatalog,
  updateQuestion,
} from '@carehub/learning';
import type { Course, QuizLesson } from '@carehub/learning';
import { IconButton } from '@carehub/ui';
import { Copy } from 'lucide-react';
import { AddButton, ItemActions } from '../editors/questions/ItemActions';
import { QuestionEditor } from '../editors/questions/QuestionEditor';
import { editQuiz } from './edit';

/** Props for {@link QuizQuestions}. */
export type QuizQuestionsProps = {
  lesson: QuizLesson;
  onChange(next: QuizLesson): void;
  course?: Course;
};

const SURVEY_TYPES = new Set(['single_choice', 'multiple_choice']);

/**
 * A quiz's own questions, each with its editor and move, copy and delete buttons, and a button per question type
 * to add one (surveys: single and multiple answer only). "Click the right spot" questions start from a picture,
 * so they are added once the picture picker is there.
 */
export function QuizQuestions({ lesson, onChange, course }: QuizQuestionsProps) {
  const survey = lesson.settings.mode === 'survey';
  const { questions } = lesson;
  const full = questions.length >= LIMITS.questions;
  const types = questionCatalog.filter(
    (entry) => entry.type !== 'hotspot' && (!survey || SURVEY_TYPES.has(entry.type)),
  );
  const edit = (change: Parameters<typeof editQuiz>[2]) =>
    onChange(editQuiz(lesson, course, change));
  return (
    <div className="flex flex-col gap-4">
      {questions.length === 0 && (
        <p className="text-small text-muted">No questions yet. Add one below.</p>
      )}
      <ol className="flex flex-col gap-4">
        {questions.map((question, index) => (
          <li key={question.id} className="flex flex-col gap-3 rounded border border-border p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-body font-medium text-fg">Question {index + 1}</h3>
              <div className="flex gap-1">
                <IconButton
                  label={`Copy question ${index + 1}`}
                  size="sm"
                  disabled={full}
                  onClick={() => edit((c) => duplicateQuestion(c, question.id))}
                >
                  <Copy aria-hidden />
                </IconButton>
                <ItemActions
                  name={`question ${index + 1}`}
                  index={index}
                  count={questions.length}
                  canRemove
                  onMove={(to) => edit((c) => moveQuestion(c, question.id, to))}
                  onRemove={() => edit((c) => deleteQuestion(c, question.id))}
                />
              </div>
            </div>
            <QuestionEditor
              question={question}
              survey={survey}
              course={course}
              onChange={(next) => edit((c) => updateQuestion(c, question.id, () => next))}
            />
          </li>
        ))}
      </ol>
      <div role="group" aria-label="Add a question" className="flex flex-wrap gap-2">
        {types.map((entry) => (
          <AddButton
            key={entry.type}
            full={full}
            onAdd={() => edit((c, lessonId) => addQuestion(c, lessonId, newQuestion(entry.type)))}
          >
            {entry.label}
          </AddButton>
        ))}
      </div>
    </div>
  );
}
