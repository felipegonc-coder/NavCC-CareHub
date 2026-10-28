import type { Link, PlayerCourse, QuestionResult } from '@carehub/learning';
import { cn } from '@carehub/ui';
import { CircleCheck, CircleX } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { RichTextView } from '../blocks/text';
import { QuestionView } from '../questions';
import { own } from '../questions/answer';
import { RightAnswer } from './RightAnswer';
import type { Answers, Outcome, Sheet } from './runs';

type QuizResultsProps = {
  course: PlayerCourse;
  go(link: Link): void;
  sheet: Sheet;
  answers: Answers;
  outcome: Outcome;
  survey: boolean;
  passMark: number;
  heading: RefObject<HTMLHeadingElement | null>;
};

const keep = () => undefined;

/**
 * A sent attempt: the score against the pass mark, then each answer marked with its feedback, and
 * the right answer under a wrong or missing one while the quiz shows right answers (0316).
 */
export function QuizResults(props: QuizResultsProps) {
  const { course, go, sheet, answers, outcome, survey, passMark, heading } = props;
  const { result, status, rightAnswers } = outcome;
  const headingClasses = 'text-h3 text-fg focus:outline-none';
  if (survey) {
    return (
      <h2 ref={heading} tabIndex={-1} className={headingClasses}>
        Thanks, your answers are in.
      </h2>
    );
  }
  const left = status.attemptsRemaining;
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 ref={heading} tabIndex={-1} className={headingClasses}>
          Your score: {result.percent}%
        </h2>
        <p className="text-body text-fg">
          {result.passed ? 'You passed.' : "You didn't pass this time."} The pass mark is {passMark}
          %.
        </p>
        {!result.passed && left !== null && (
          <p className="text-small text-muted">
            {left === 0
              ? 'You have no tries left.'
              : `${left} ${left === 1 ? 'try' : 'tries'} left.`}
          </p>
        )}
      </div>
      <ol className="flex flex-col gap-8">
        {sheet.questions.map((question, index) => {
          const marked = result.results.find((entry) => entry.questionId === question.id);
          const right =
            rightAnswers && !marked?.correct ? own(rightAnswers, question.id) : undefined;
          return (
            <li key={question.id} className="flex flex-col gap-3">
              <QuestionView
                question={question}
                response={answers[question.id]}
                onChange={keep}
                disabled
                label={`Question ${index + 1} of ${sheet.questions.length}`}
                course={course}
                go={go}
              />
              {marked && (
                <Mark result={marked} course={course} go={go}>
                  {right && <RightAnswer question={question} answer={right} />}
                </Mark>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

type MarkProps = Pick<QuizResultsProps, 'course' | 'go'> & {
  result: QuestionResult;
  /** The right answer, shown before the feedback. */
  children?: ReactNode;
};

function Mark({ result, course, go, children }: MarkProps) {
  const words = result.correct ? 'Correct' : result.answered ? 'Not quite' : 'Not answered';
  return (
    <div className="flex flex-col gap-2">
      <p
        className={cn(
          'flex items-center gap-2 text-body font-medium',
          result.correct ? 'text-success' : 'text-danger',
        )}
      >
        {result.correct ? <CircleCheck aria-hidden /> : <CircleX aria-hidden />}
        {words}
      </p>
      {children}
      {result.feedback && <RichTextView value={result.feedback} course={course} go={go} />}
    </div>
  );
}
