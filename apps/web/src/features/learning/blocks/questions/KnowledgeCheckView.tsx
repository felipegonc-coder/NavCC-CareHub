import {
  playerLabels,
  type KnowledgeCheckBlock,
  type QuestionResponse,
  type QuestionResult,
} from '@carehub/learning';
import { Button, cn } from '@carehub/ui';
import { CircleCheck, CircleX } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { givenAnswer, hasAnswer, newSeed, practice, QuestionView } from '../../questions';
import type { BlockViewProps } from '../registry';
import { RichTextView } from '../text';

/**
 * A practice question in a lesson; it never counts towards the score. Checking shows right or
 * wrong and the feedback at once and records only whether the answer was right (decision 0310):
 * the answer itself stays here. With `allowRetry` the learner can try again, freshly shuffled.
 */
export function KnowledgeCheckView(props: BlockViewProps<KnowledgeCheckBlock>) {
  const { block, lesson, course, state, emit, go } = props;
  const hintId = useId();
  const [seed, setSeed] = useState(newSeed);
  const sheet = useMemo(() => practice(block.question, seed), [block.question, seed]);
  const [response, setResponse] = useState<QuestionResponse>();
  const [result, setResult] = useState<QuestionResult | null>(null);
  const answeredBefore = state.knowledgeChecks.some(
    (check) => check.lessonId === lesson.id && check.blockId === block.id,
  );
  const ready = hasAnswer(sheet.paper, response);

  const check = () => {
    const outcome = sheet.check(givenAnswer(sheet.paper, response));
    setResult(outcome);
    emit({
      type: 'knowledge_check_answered',
      lessonId: lesson.id,
      blockId: block.id,
      correct: outcome.correct,
    });
  };
  const retry = () => {
    setSeed(newSeed());
    setResponse(undefined);
    setResult(null);
  };

  return (
    <div className="flex flex-col gap-4 rounded border border-border p-4 md:p-6">
      <p className="text-small font-medium text-muted">Knowledge check</p>
      {answeredBefore && !block.allowRetry && !result ? (
        <>
          <RichTextView value={block.question.prompt} course={course} go={go} />
          <p className="text-small text-muted">You've answered this check.</p>
        </>
      ) : (
        <>
          <QuestionView
            key={seed}
            question={sheet.paper}
            response={response}
            onChange={setResponse}
            disabled={result !== null}
            course={course}
            go={go}
          />
          <div role="status" className="flex flex-col gap-2">
            {result && (
              <>
                <p
                  className={cn(
                    'flex items-center gap-2 text-body font-medium',
                    result.correct ? 'text-success' : 'text-danger',
                  )}
                >
                  {result.correct ? <CircleCheck aria-hidden /> : <CircleX aria-hidden />}
                  {result.correct ? 'Correct' : 'Not quite'}
                </p>
                <RichTextView value={result.feedback ?? undefined} course={course} go={go} />
              </>
            )}
          </div>
          {!result && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={!ready}
                aria-describedby={ready ? undefined : hintId}
                onClick={check}
              >
                Check answer
              </Button>
              {!ready && (
                <p id={hintId} className="text-small text-muted">
                  Answer the question to check it.
                </p>
              )}
            </div>
          )}
          {result && block.allowRetry && (
            <Button variant="secondary" onClick={retry} className="self-start">
              {playerLabels(course).retry}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
