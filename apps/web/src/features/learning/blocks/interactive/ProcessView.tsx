import { processView, type ProcessBlock } from '@carehub/learning';
import { Button } from '@carehub/ui';
import { useEffect, useRef, useState } from 'react';
import { Picture } from '../media/Picture';
import type { BlockViewProps } from '../registry';
import { RichTextView } from '../text/RichTextView';
import { finishedBefore } from './finished';

/**
 * A process block: its intro, then one step at a time with Back and Next, then its summary. Moving to another
 * screen puts focus on its title so screen readers read it. The block is done once the last step is shown.
 */
export function ProcessView(props: BlockViewProps<ProcessBlock>) {
  const { block, lesson, course, go, emit } = props;
  const [index, setIndex] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const reported = useRef(finishedBefore(props));
  const view = processView(block, index);

  useEffect(() => {
    if (!view.completed || reported.current || block.steps.length === 0) return;
    reported.current = true;
    emit({ type: 'block_completed', lessonId: lesson.id, blockId: block.id });
  }, [view.completed, block.steps.length, block.id, lesson.id, emit]);

  useEffect(() => {
    if (moved.current) title.current?.focus();
  }, [view.index]);

  const screen = view.screen;
  const step = screen?.kind === 'step' ? block.steps[screen.number - 1] : undefined;
  const part =
    screen?.kind === 'intro' ? block.intro : screen?.kind === 'summary' ? block.summary : step;
  const move = (by: number) => {
    moved.current = true;
    setIndex(view.index + by);
  };

  return (
    <div className="flex flex-col gap-4 rounded border border-border p-6">
      <p className="text-small text-muted">
        {screen?.kind === 'step'
          ? `Step ${screen.number} of ${view.stepCount}`
          : screen?.kind === 'summary'
            ? 'Summary'
            : 'Introduction'}
      </p>
      <h3 ref={title} tabIndex={-1} className="text-title font-semibold">
        {part?.title}
      </h3>
      {step?.image && <Picture image={step.image} />}
      <RichTextView value={part?.body} course={course} go={go} />
      <div className="flex justify-between gap-2">
        <Button variant="secondary" disabled={!view.canGoBack} onClick={() => move(-1)}>
          Back
        </Button>
        <Button disabled={!view.canGoNext} onClick={() => move(1)}>
          {screen?.kind === 'intro' ? 'Start' : 'Next'}
        </Button>
      </div>
    </div>
  );
}
