import { flashcardsProgress, type FlashcardsBlock, type Id } from '@carehub/learning';
import { Button, cn, VisuallyHidden } from '@carehub/ui';
import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Picture } from '../media/Picture';
import type { BlockViewProps } from '../registry';
import { finishedBefore } from './finished';

/**
 * A flashcards block: each card shows its front, and "Turn over" shows its back (and the front again). The
 * new side is read out. The block is done once every card has been turned over.
 */
export function FlashcardsView(props: BlockViewProps<FlashcardsBlock>) {
  const { block, lesson, emit } = props;
  const before = finishedBefore(props);
  const [backs, setBacks] = useState<ReadonlySet<Id>>(() => new Set());
  const [seen, setSeen] = useState<ReadonlySet<Id>>(
    () => new Set(before ? block.cards.map((card) => card.id) : []),
  );
  const reported = useRef(before);
  const progress = flashcardsProgress(block, seen);

  useEffect(() => {
    if (!progress.done || reported.current || progress.total === 0) return;
    reported.current = true;
    emit({ type: 'block_completed', lessonId: lesson.id, blockId: block.id });
  }, [progress.done, progress.total, block.id, lesson.id, emit]);

  function turn(id: Id) {
    setBacks((shown) => {
      const next = new Set(shown);
      if (!next.delete(id)) next.add(id);
      return next;
    });
    setSeen((ids) => new Set(ids).add(id));
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="grid gap-4 md:grid-cols-2">
        {block.cards.map((card, i) => {
          const back = backs.has(card.id);
          const image = back ? card.backImage : card.frontImage;
          return (
            <li
              key={card.id}
              className={cn(
                'flex min-h-40 flex-col gap-3 rounded border p-4',
                back ? 'border-primary bg-fill' : 'border-border bg-bg',
              )}
            >
              <div aria-live="polite" className="flex flex-1 flex-col gap-3">
                <p className="text-label font-medium text-muted">
                  {back ? 'Back' : 'Front'}
                  <VisuallyHidden> of card {i + 1}</VisuallyHidden>
                </p>
                {image && <Picture image={image} caption={false} imgClassName="max-h-32 w-auto" />}
                <p className={cn('whitespace-pre-line', !back && 'font-semibold')}>
                  {back ? card.back : card.front}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Turn over card ${i + 1}`}
                onClick={() => turn(card.id)}
              >
                <RotateCcw aria-hidden />
                Turn over
              </Button>
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" className="text-small text-muted">
        {progress.done
          ? "You've turned over every card."
          : `${progress.seen} of ${progress.total} cards turned over.`}
      </p>
    </div>
  );
}
