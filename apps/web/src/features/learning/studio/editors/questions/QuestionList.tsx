import { newQuestion, questionCatalog } from '@carehub/learning';
import type { Course, Id, Question } from '@carehub/learning';
import { IconButton } from '@carehub/ui';
import { Copy } from 'lucide-react';
import { AddButton, ItemActions } from './ItemActions';
import { QuestionEditor } from './QuestionEditor';

/** Props for {@link QuestionList}. Each change names the question by id. */
export type QuestionListProps = {
  questions: readonly Question[];
  /** The most questions the list holds; Copy and the add buttons are off once it's full. */
  max: number;
  /** Survey questions: only single and multiple answer can be added, without right answers or points. */
  survey?: boolean;
  /** The course, for links to its lessons in rich text. Banks have none. */
  course?: Course;
  onAdd(question: Question): void;
  onUpdate(id: Id, next: Question): void;
  onCopy(id: Id): void;
  onMove(id: Id, toIndex: number): void;
  onRemove(id: Id): void;
};

const SURVEY_TYPES = new Set<Question['type']>(['single_choice', 'multiple_choice']);

/**
 * A list of questions (a quiz's own or a bank's), each with its editor and copy, move and remove buttons, and a
 * button per question type to add one. "Click the right spot" questions start from a picture, so they are added
 * once the picture picker is there.
 */
export function QuestionList(props: QuestionListProps) {
  const { questions, survey = false, course } = props;
  const full = questions.length >= props.max;
  const types = questionCatalog.filter(
    (entry) => entry.type !== 'hotspot' && (!survey || SURVEY_TYPES.has(entry.type)),
  );
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
                  onClick={() => props.onCopy(question.id)}
                >
                  <Copy aria-hidden />
                </IconButton>
                <ItemActions
                  name={`question ${index + 1}`}
                  index={index}
                  count={questions.length}
                  canRemove
                  onMove={(to) => props.onMove(question.id, to)}
                  onRemove={() => props.onRemove(question.id)}
                />
              </div>
            </div>
            <QuestionEditor
              question={question}
              survey={survey}
              course={course}
              onChange={(next) => props.onUpdate(question.id, next)}
            />
          </li>
        ))}
      </ol>
      <div role="group" aria-label="Add a question" className="flex flex-wrap gap-2">
        {types.map((entry) => (
          <AddButton
            key={entry.type}
            full={full}
            onAdd={() => props.onAdd(newQuestion(entry.type))}
          >
            {entry.label}
          </AddButton>
        ))}
      </div>
    </div>
  );
}
