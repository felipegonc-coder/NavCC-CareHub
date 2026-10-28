import { SurveySummarySchema } from '@carehub/learning';
import type {
  Id,
  SurveyAnswerCount,
  SurveyQuestionSummary,
  SurveySummary,
} from '@carehub/learning';
import { EmptyState, ErrorState, LoadingState } from '@carehub/ui';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { api, LearningApiError } from '../../data';

/** Props for {@link SurveyResults}. */
export type SurveyResultsProps = {
  courseId: Id;
  /** A survey lesson of the course (a quiz lesson in survey mode). */
  lessonId: Id;
  /** The heading, such as the lesson's title. Default "Survey answers". */
  title?: string;
};

/** The cache key of one survey's answer counts. */
export const surveySummaryKey = (courseId: Id, lessonId: Id) =>
  ['learning', 'reports', 'course', courseId, 'survey', lessonId] as const;

const surveyPath = (courseId: Id, lessonId: Id) =>
  `/reports/courses/${encodeURIComponent(courseId)}/surveys/${encodeURIComponent(lessonId)}`;

/** A survey lesson's answer counts per question, without names (`GET /reports/courses/:id/surveys/:lessonId`). */
export function useSurveySummary(courseId: Id, lessonId: Id) {
  return useQuery({
    queryKey: surveySummaryKey(courseId, lessonId),
    queryFn: ({ signal }) =>
      api('GET', surveyPath(courseId, lessonId), SurveySummarySchema, { signal }),
  });
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// The server's plain words (for example a survey that isn't in the course), or a general line.
const errorMessage = (error: unknown) =>
  error instanceof LearningApiError ? error.message : "The survey answers couldn't load.";

function AnswerCounts({ answers }: { answers: SurveyAnswerCount[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {answers.map((answer) => (
        <li key={answer.optionId} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-body text-fg">{answer.text}</span>
            <span className="text-small text-muted">
              {count(answer.count, 'person', 'people')}
              {answer.percent !== null && ` · ${answer.percent}%`}
            </span>
          </div>
          <div aria-hidden className="h-2 w-full rounded-full bg-fill">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${answer.percent ?? 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function QuestionAnswers({
  question,
  number,
  submissions,
}: {
  question: SurveyQuestionSummary;
  number: number;
  submissions: number;
}) {
  return (
    <li className="flex flex-col gap-2 rounded border border-border p-4">
      <h3 className="text-body font-semibold text-fg">
        {question.prompt.trim() || `Question ${number}`}
      </h3>
      <p className="text-small text-muted">
        {question.answered} of {submissions} answered
        {question.type === 'multiple_choice' &&
          '. People could pick more than one answer, so the percents can add up to more than 100.'}
      </p>
      {question.answers.length > 0 && <AnswerCounts answers={question.answers} />}
    </li>
  );
}

function SurveyAnswers({ summary }: { summary: SurveySummary }) {
  return (
    <>
      <p className="text-body text-muted">{count(summary.submissions, 'response', 'responses')}</p>
      <ol className="flex flex-col gap-4">
        {summary.questions.map((question, index) => (
          <QuestionAnswers
            key={question.questionId}
            question={question}
            number={index + 1}
            submissions={summary.submissions}
          />
        ))}
      </ol>
    </>
  );
}

/**
 * A survey lesson's answers, for the course report (`/learning/reports/courses/:courseId`): how many people
 * answered, and how often each answer was picked, without names. It's a section with an h2 (the report has the
 * page's main and h1) and its own loading, empty and error states. For people with `learning.analytics`.
 */
export function SurveyResults({
  courseId,
  lessonId,
  title = 'Survey answers',
}: SurveyResultsProps) {
  const headingId = useId();
  const survey = useSurveySummary(courseId, lessonId);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="text-h2 text-fg">
        {title}
      </h2>
      {survey.isPending ? (
        <LoadingState label="Loading the survey answers" />
      ) : survey.isError ? (
        <ErrorState
          message={errorMessage(survey.error)}
          onRetry={() => void survey.refetch()}
          retrying={survey.isFetching}
        />
      ) : survey.data.submissions === 0 ? (
        <EmptyState message="No answers yet." />
      ) : (
        <SurveyAnswers summary={survey.data} />
      )}
    </section>
  );
}
