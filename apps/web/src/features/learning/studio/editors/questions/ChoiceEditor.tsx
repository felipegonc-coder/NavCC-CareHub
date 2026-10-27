import {
  addQuestionItem,
  LIMITS,
  moveQuestionItem,
  QUESTION_LIST_SIZES,
  removeQuestionItem,
  setTrueFalseAnswer,
  toggleCorrectOption,
  updateQuestionItem,
} from '@carehub/learning';
import type { Course, Question, RichText } from '@carehub/learning';
import { Checkbox, Field, Input } from '@carehub/ui';
import { RichTextInput } from '../text/RichTextInput';
import { AddButton, ItemActions } from './ItemActions';

type Choice = Extract<Question, { type: 'single_choice' | 'multiple_choice' }>;

/** Props for {@link ChoiceEditor}. In a survey there are no right answers, so those controls are hidden. */
export type ChoiceEditorProps = {
  question: Choice;
  onChange(next: Question): void;
  survey: boolean;
  course?: Course;
};

/** The answers of a single or multiple choice question: text, which are right, and feedback for each. */
export function ChoiceEditor({ question, onChange, survey, course }: ChoiceEditorProps) {
  const { options } = question;
  const { min, max } = QUESTION_LIST_SIZES.options;
  const update = (id: string, patch: { text?: string; feedback?: RichText }) =>
    onChange(updateQuestionItem(question, 'options', id, patch));
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {options.map((option, index) => (
          <li key={option.id} className="flex flex-col gap-2 rounded border border-border p-3">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`Answer ${index + 1}`}
                value={option.text}
                maxLength={LIMITS.shortText}
                onChange={(event) => update(option.id, { text: event.target.value })}
              />
              <ItemActions
                name={`answer ${index + 1}`}
                index={index}
                count={options.length}
                canRemove={options.length > min}
                onMove={(to) => onChange(moveQuestionItem(question, 'options', option.id, to))}
                onRemove={() => onChange(removeQuestionItem(question, 'options', option.id))}
              />
            </div>
            {!survey && (
              <Field layout="inline" label="Right answer">
                <Checkbox
                  aria-label={`Right answer (answer ${index + 1})`}
                  checked={option.correct}
                  onCheckedChange={() => onChange(toggleCorrectOption(question, option.id))}
                />
              </Field>
            )}
            {!survey && (
              <details>
                <summary className="cursor-pointer text-small text-muted">
                  {option.feedback
                    ? 'Feedback for this answer (added)'
                    : 'Feedback for this answer'}
                </summary>
                <div className="pt-2">
                  <RichTextInput
                    ariaLabel={`Feedback for answer ${index + 1}`}
                    value={option.feedback ?? []}
                    onChange={(feedback) => update(option.id, { feedback })}
                    course={course}
                  />
                </div>
              </details>
            )}
          </li>
        ))}
      </ol>
      <div>
        <AddButton
          full={options.length >= max}
          onAdd={() => onChange(addQuestionItem(question, 'options'))}
        >
          Add answer
        </AddButton>
      </div>
    </div>
  );
}

/** Props for {@link TrueFalseEditor}. */
export type TrueFalseEditorProps = {
  question: Extract<Question, { type: 'true_false' }>;
  onChange(next: Question): void;
};

/** Whether a true-or-false statement is true. */
export function TrueFalseEditor({ question, onChange }: TrueFalseEditorProps) {
  return (
    <Field layout="inline" label="The statement is true">
      <Checkbox
        checked={question.answer}
        onCheckedChange={(checked) => onChange(setTrueFalseAnswer(question, checked === true))}
      />
    </Field>
  );
}
