import {
  LIMITS,
  questionCatalog,
  questionProblems,
  setQuestionFeedback,
  setQuestionPoints,
  setQuestionPrompt,
} from '@carehub/learning';
import type { Course, Question, RichText } from '@carehub/learning';
import { Field, Input } from '@carehub/ui';
import { useId, useMemo } from 'react';
import { RichTextInput } from '../text/RichTextInput';
import { ChoiceEditor, TrueFalseEditor } from './ChoiceEditor';
import { FillBlankEditor } from './FillBlankEditor';
import { HotspotEditor } from './HotspotEditor';
import { ListEditor } from './ListEditors';

/** Props for {@link QuestionEditor}. */
export type QuestionEditorProps = {
  question: Question;
  onChange(next: Question): void;
  /** Survey questions have no right answers, points or feedback, so those controls are hidden. */
  survey?: boolean;
  /** Knowledge checks never count towards a score, so they hide points. Default true. */
  showPoints?: boolean;
  /** The course, for links to its lessons in rich text. */
  course?: Course;
};

/** The name of a question type, as in the "Add question" menu ("Single answer", "Put in order" ...). */
export function questionTypeLabel(type: Question['type']): string {
  return questionCatalog.find((entry) => entry.type === type)?.label ?? type;
}

function RichField(props: {
  label: string;
  value: RichText;
  onChange(next: RichText): void;
  course: Course | undefined;
}) {
  const id = useId();
  return (
    <Field label={props.label} id={id}>
      <RichTextInput
        id={id}
        ariaLabel={props.label}
        value={props.value}
        onChange={props.onChange}
        course={props.course}
      />
    </Field>
  );
}

type FeedbackField = [
  which: 'correct' | 'incorrect' | 'true' | 'false',
  label: string,
  value?: RichText,
];

/** Feedback after a right or wrong answer and, for true or false, after each answer. */
function feedbackFields(question: Question): FeedbackField[] {
  const fields: FeedbackField[] = [
    ['correct', 'Feedback when right', question.feedback?.correct],
    ['incorrect', 'Feedback when wrong', question.feedback?.incorrect],
  ];
  if (question.type !== 'true_false') return fields;
  return [
    ...fields,
    ['true', 'Feedback after answering true', question.feedbackTrue],
    ['false', 'Feedback after answering false', question.feedbackFalse],
  ];
}

function Answers({
  question,
  onChange,
  survey,
  course,
}: Required<Omit<QuestionEditorProps, 'showPoints' | 'course'>> & { course: Course | undefined }) {
  switch (question.type) {
    case 'single_choice':
    case 'multiple_choice':
      return (
        <ChoiceEditor question={question} onChange={onChange} survey={survey} course={course} />
      );
    case 'true_false':
      return <TrueFalseEditor question={question} onChange={onChange} />;
    case 'matching':
    case 'drag_matching':
    case 'ordering':
      return <ListEditor question={question} onChange={onChange} />;
    case 'fill_blank':
      return <FillBlankEditor question={question} onChange={onChange} />;
    case 'hotspot':
      return <HotspotEditor question={question} onChange={onChange} />;
  }
}

/**
 * Edits one question of any of the 8 types: its text, points, answers and feedback, with the problems that
 * would stop it from being published listed underneath as people type.
 */
export function QuestionEditor({
  question,
  onChange,
  survey = false,
  showPoints = true,
  course,
}: QuestionEditorProps) {
  const problems = useMemo(() => questionProblems(question, { survey }), [question, survey]);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-small font-medium text-muted">{questionTypeLabel(question.type)}</p>
      <RichField
        label="Question"
        value={question.prompt}
        onChange={(prompt) => onChange(setQuestionPrompt(question, prompt))}
        course={course}
      />
      {showPoints && !survey && (
        <Field label="Points" className="max-w-40">
          <Input
            type="number"
            min={1}
            max={LIMITS.questionPoints}
            value={question.points ?? ''}
            onChange={(event) => onChange(setQuestionPoints(question, event.target.valueAsNumber))}
          />
        </Field>
      )}
      <Answers question={question} onChange={onChange} survey={survey} course={course} />
      {!survey &&
        feedbackFields(question).map(([which, label, value]) => (
          <RichField
            key={which}
            label={label}
            value={value ?? []}
            onChange={(next) => onChange(setQuestionFeedback(question, which, next))}
            course={course}
          />
        ))}
      {problems.length > 0 && (
        <div className="rounded border border-border p-3">
          <p className="text-small font-medium text-fg">Before this can be published:</p>
          <ul className="list-disc pl-5 text-small text-danger">
            {problems.map((problem) => (
              <li key={`${problem.path}:${problem.message}`}>{problem.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
