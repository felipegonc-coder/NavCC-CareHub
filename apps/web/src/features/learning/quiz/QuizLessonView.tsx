import {
  playerLabels,
  plannedQuestionCount,
  type LearnerCourseState,
  type LearnerQuizLesson,
  type Link,
  type NewProgressEvent,
  type PlayerCourse,
  type QuizLesson,
  type QuizStatus,
} from '@carehub/learning';
import { Button } from '@carehub/ui';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { RichTextView } from '../blocks/text';
import { givenAnswer, hasAnswer, QuestionView } from '../questions';
import { QuizResults } from './QuizResults';
import {
  useDraftRun,
  useServerRun,
  type Answers,
  type Outcome,
  type QuizRun,
  type Sheet,
} from './runs';

/** What the player and Studio's preview pass (docs/learning/PLAN.md, "Quiz"). */
export type QuizLessonViewProps = {
  course: PlayerCourse;
  lesson: QuizLesson | LearnerQuizLesson;
  state: LearnerCourseState;
  emit(event: NewProgressEvent): void;
  /** For links in the intro and the questions. */
  go(link: Link): void;
};

/**
 * A quiz lesson: its intro, an attempt's questions, then the score and each answer marked, with
 * another try while the quiz allows one. The learner view has no questions, so attempts start and
 * are scored on the server and need a connection (decision 0302). The full draft (Studio preview,
 * review links) plans and scores them in the browser.
 */
export function QuizLessonView(props: QuizLessonViewProps) {
  const { lesson } = props;
  return 'questions' in lesson ? (
    <DraftQuiz {...props} lesson={lesson} />
  ) : (
    <LearnerQuiz {...props} lesson={lesson} />
  );
}

function LearnerQuiz(props: QuizLessonViewProps & { lesson: LearnerQuizLesson }) {
  const run = useServerRun(props.course.id, props.lesson, props.state);
  return <Quiz {...props} run={run} count={props.lesson.questionCount} draft={false} />;
}

function DraftQuiz(props: QuizLessonViewProps & { lesson: QuizLesson }) {
  const run = useDraftRun(props.lesson);
  return <Quiz {...props} run={run} count={plannedQuestionCount(props.lesson)} draft />;
}

type QuizProps = Pick<QuizLessonViewProps, 'course' | 'lesson' | 'go'> & {
  run: QuizRun;
  count: number;
  draft: boolean;
};

function Quiz({ course, lesson, go, run, count, draft }: QuizProps) {
  const labels = playerLabels(course);
  const survey = lesson.settings.mode === 'survey';
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // A new paper or a result moves the focus to its heading, so screen readers start there.
  const screen = outcome ? 'results' : sheet ? `paper-${sheet.attemptId}` : 'intro';
  useEffect(() => {
    if (screen !== 'intro') heading.current?.focus();
  }, [screen]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const start = () =>
    act(async () => {
      const next = await run.start();
      setSheet(next);
      setAnswers({});
      setOutcome(null);
    });
  const submit = (current: Sheet) =>
    act(async () => {
      const given = current.questions.flatMap((question) => {
        const answer = givenAnswer(question, answers[question.id]);
        return answer && hasAnswer(question, answer) ? [[question.id, answer] as const] : [];
      });
      setOutcome(await run.submit(current, Object.fromEntries(given)));
    });

  let content: ReactNode;
  let action: { label: string; onClick(): void } | null = null;
  if (sheet && outcome) {
    content = (
      <QuizResults
        {...{ course, go, sheet, answers, outcome, survey, heading }}
        passMark={lesson.settings.passMark}
      />
    );
    if (outcome.status.canRetry) action = { label: labels.retry, onClick: () => void start() };
  } else if (sheet) {
    content = (
      <Paper
        {...{ course, go, sheet, answers, heading }}
        disabled={busy}
        onAnswer={(id, response) => setAnswers((all) => ({ ...all, [id]: response }))}
      />
    );
    action = { label: labels.submit, onClick: () => void submit(sheet) };
  } else {
    content = <QuizIntro {...{ course, go, lesson, count, survey, draft }} status={run.status} />;
    if (count > 0 && run.status.canRetry) {
      const first = survey ? 'Start survey' : 'Start quiz';
      const label = run.open ? 'Carry on' : run.status.attemptsUsed > 0 ? labels.retry : first;
      action = { label, onClick: () => void start() };
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {content}
      {(action || error) && (
        <div className="flex flex-col items-start gap-2">
          {action && (
            <Button loading={busy} onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {error && (
            <p role="alert" className="text-small text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

type IntroProps = Pick<QuizProps, 'course' | 'go' | 'lesson' | 'count' | 'draft'> & {
  survey: boolean;
  status: QuizStatus;
};

const tries = (count: number) => (count === 1 ? '1 try' : `${count} tries`);
const allowed = (max: number | null) =>
  max === null ? 'As many tries as you need' : max === 1 ? 'One try' : `Up to ${max} tries`;

/** What the quiz is, where the learner stands, and that it needs a connection. */
function QuizIntro({ course, go, lesson, count, draft, survey, status }: IntroProps) {
  const { passMark, maxAttempts } = lesson.settings;
  const best = status.bestPercent === null ? '' : ` Your best score is ${status.bestPercent}%.`;
  let standing: string | null = null;
  if (survey && status.attemptsUsed > 0) standing = 'Thanks, your answers are in.';
  else if (status.passed) standing = `You passed.${best}`;
  else if (status.attemptsUsed > 0 && status.attemptsRemaining === 0) {
    standing = `You have no tries left.${best}`;
  } else if (status.attemptsUsed > 0) {
    const left =
      status.attemptsRemaining === null ? '' : ` ${tries(status.attemptsRemaining)} left.`;
    standing = `You haven't passed yet.${best}${left}`;
  }
  return (
    <div className="flex flex-col gap-4">
      {lesson.intro && <RichTextView value={lesson.intro} course={course} go={go} />}
      <ul className="flex flex-col gap-1 text-body text-fg">
        <li>{count === 1 ? '1 question' : `${count} questions`}</li>
        {survey ? (
          <li>A survey: there are no right or wrong answers, and you send it once.</li>
        ) : (
          <>
            <li>Pass mark: {passMark}%</li>
            <li>{allowed(maxAttempts)}</li>
          </>
        )}
      </ul>
      {standing && <p className="text-body font-medium text-fg">{standing}</p>}
      {count === 0 && <p className="text-small text-muted">This quiz has no questions yet.</p>}
      <p className="text-small text-muted">
        {draft
          ? 'Preview: answers are checked here and not saved.'
          : 'You need a connection to start the quiz and to send your answers.'}
      </p>
    </div>
  );
}

type PaperProps = Pick<QuizProps, 'course' | 'go'> & {
  sheet: Sheet;
  answers: Answers;
  disabled: boolean;
  onAnswer(id: string, response: Answers[string]): void;
  heading: RefObject<HTMLHeadingElement | null>;
};

/** An attempt's questions, answered in any order. The answers stay here until they are sent. */
function Paper({ course, go, sheet, answers, disabled, onAnswer, heading }: PaperProps) {
  const total = sheet.questions.length;
  const answered = sheet.questions.filter((question) =>
    hasAnswer(question, answers[question.id]),
  ).length;
  return (
    <section className="flex flex-col gap-6">
      <h2 ref={heading} tabIndex={-1} className="text-h3 text-fg focus:outline-none">
        Questions
      </h2>
      <ol className="flex flex-col gap-8">
        {sheet.questions.map((question, index) => (
          <li key={question.id}>
            <QuestionView
              question={question}
              response={answers[question.id]}
              onChange={(response) => onAnswer(question.id, response)}
              disabled={disabled}
              label={`Question ${index + 1} of ${total}`}
              course={course}
              go={go}
            />
          </li>
        ))}
      </ol>
      <p className="text-small text-muted">
        {answered} of {total} answered.
      </p>
    </section>
  );
}
