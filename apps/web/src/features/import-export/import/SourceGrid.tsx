import type { ImportSource, ImportSourceId } from '@carehub/extras/import-export/import/index';
import { cn } from '@carehub/ui';
import { useId, useRef, useState, type KeyboardEvent } from 'react';

// The grid of sources on the Import screen (Import and export spec, sections 2 and 6): one Tab
// stop, arrow keys move between sources, Home and End go to the ends, Enter or Space chooses.

const MOVES: Record<string, (at: number, count: number) => number> = {
  ArrowRight: (at, count) => (at + 1) % count,
  ArrowDown: (at, count) => (at + 1) % count,
  ArrowLeft: (at, count) => (at - 1 + count) % count,
  ArrowUp: (at, count) => (at - 1 + count) % count,
  Home: () => 0,
  End: (_at, count) => count - 1,
};

export interface SourceGridProps {
  sources: readonly ImportSource[];
  chosen: ImportSourceId | null;
  onChoose(source: ImportSource): void;
  /** The id of the text naming the grid. */
  labelledBy: string;
}

export function SourceGrid({ sources, chosen, onChoose, labelledBy }: SourceGridProps) {
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const chosenAt = sources.findIndex((source) => source.id === chosen);
  const [focusAt, setFocusAt] = useState(Math.max(0, chosenAt));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = MOVES[event.key];
    if (!move || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const next = move(focusAt, sources.length);
    setFocusAt(next);
    buttons.current[next]?.focus();
  };

  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {sources.map((source, index) => {
        const pressed = source.id === chosen;
        return (
          <button
            key={source.id}
            ref={(button) => {
              buttons.current[index] = button;
            }}
            type="button"
            aria-pressed={pressed}
            aria-labelledby={`${id}-${source.id}`}
            aria-describedby={`${id}-${source.id}-how`}
            tabIndex={index === focusAt ? 0 : -1}
            onFocus={() => setFocusAt(index)}
            onClick={() => onChoose(source)}
            className={cn(
              'flex flex-col items-start gap-1 rounded border p-4 text-left transition-colors hover:bg-fill-hover',
              pressed ? 'border-primary bg-fill' : 'border-border',
            )}
          >
            <span id={`${id}-${source.id}`} className="text-body font-medium">
              {source.label}
            </span>
            <span id={`${id}-${source.id}-how`} className="text-small text-muted">
              {source.howTo}
            </span>
          </button>
        );
      })}
    </div>
  );
}
