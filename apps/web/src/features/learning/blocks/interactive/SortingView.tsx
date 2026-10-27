import {
  checkSorting,
  keepCorrectPlacements,
  sortingDeck,
  type Id,
  type SortingBlock,
  type SortingCheck,
} from '@carehub/learning';
import { Button, cn, IconButton } from '@carehub/ui';
import { Check, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BlockViewProps } from '../registry';
import { finishedBefore } from './finished';

const solved = (block: SortingBlock): Record<Id, Id> =>
  Object.fromEntries(block.items.map((item) => [item.id, item.categoryId]));

/**
 * A sorting activity: pick an item, then the category it belongs in (both are buttons, so it works the same
 * with a pointer, touch or the keyboard), then Check. Right answers stay; wrong ones go back to the list to
 * try again. The block is done once everything is sorted right.
 */
export function SortingView(props: BlockViewProps<SortingBlock>) {
  const { block, lesson, emit } = props;
  const before = finishedBefore(props);
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 32));
  const [placements, setPlacements] = useState<Record<Id, Id>>(() => (before ? solved(block) : {}));
  const [picked, setPicked] = useState<Id>();
  const [result, setResult] = useState<SortingCheck | undefined>(() =>
    before ? checkSorting(block, solved(block)) : undefined,
  );
  const reported = useRef(before);
  const deck = sortingDeck(block, seed, placements);
  const done = result?.allCorrect ?? false;
  const right = new Set(result?.correctIds);
  const text = (id: Id | undefined) => block.items.find((item) => item.id === id)?.text ?? '';

  useEffect(() => {
    if (!done || reported.current || block.items.length === 0) return;
    reported.current = true;
    emit({ type: 'block_completed', lessonId: lesson.id, blockId: block.id });
  }, [done, block.items.length, block.id, lesson.id, emit]);

  function place(categoryId: Id) {
    if (picked === undefined) return;
    setPlacements((current) => ({ ...current, [picked]: categoryId }));
    setPicked(undefined);
  }
  function putBack(itemId: Id) {
    setPlacements((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }
  function check() {
    setResult(checkSorting(block, placements));
    setPlacements(keepCorrectPlacements(block, placements));
  }

  let status = 'Pick an item, then the category it belongs in.';
  if (picked !== undefined) status = `"${text(picked)}" picked. Now pick its category.`;
  else if (done) status = 'Everything is sorted correctly.';
  else if (deck.length === 0) status = 'Everything is sorted. Check your answers.';
  else if (result)
    status = `${result.correctIds.length} of ${result.total} right. The others are back in the list: try them again.`;

  return (
    <div className="flex flex-col gap-4">
      {deck.length > 0 && (
        <ul aria-label="Items to sort" className="flex flex-wrap gap-2">
          {deck.map((item) => (
            <li key={item.id}>
              <Button
                variant={picked === item.id ? 'primary' : 'secondary'}
                aria-pressed={picked === item.id}
                onClick={() => setPicked(picked === item.id ? undefined : item.id)}
              >
                {item.text}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {block.categories.map((category) => (
          <section
            key={category.id}
            className="flex flex-col gap-3 rounded border border-border p-4"
          >
            <h3 className="font-semibold">{category.title}</h3>
            <ul className="flex flex-col gap-2">
              {block.items
                .filter((item) => placements[item.id] === category.id)
                .map((item) => (
                  <li
                    key={item.id}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded bg-fill px-3 py-2',
                      right.has(item.id) && 'text-success',
                    )}
                  >
                    <span className="text-fg">{item.text}</span>
                    {right.has(item.id) ? (
                      <span className="flex items-center gap-1 text-small">
                        <Check aria-hidden className="size-4 shrink-0" />
                        Right
                      </span>
                    ) : (
                      <IconButton
                        label={`Put "${item.text}" back in the list`}
                        size="sm"
                        variant="ghost"
                        onClick={() => putBack(item.id)}
                      >
                        <Undo2 aria-hidden />
                      </IconButton>
                    )}
                  </li>
                ))}
            </ul>
            {!done && (
              <Button
                variant="secondary"
                size="sm"
                disabled={picked === undefined}
                aria-label={`Put here: ${category.title}`}
                onClick={() => place(category.id)}
              >
                Put here
              </Button>
            )}
          </section>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {!done && (
          <Button disabled={deck.length > 0} onClick={check}>
            Check
          </Button>
        )}
        <p aria-live="polite" className="text-small text-muted">
          {status}
        </p>
      </div>
    </div>
  );
}
