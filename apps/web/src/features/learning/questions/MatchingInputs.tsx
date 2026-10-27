import type { Id } from '@carehub/learning';
import { cn } from '@carehub/ui';
import { useId, useState } from 'react';
import { answerFor, own, withEntry, type InputProps } from './answer';

/** The design kit's text field look, for a native select (works the same on phones). */
const selectClasses =
  'flex h-9 w-full rounded border border-border bg-bg px-3 text-small text-fg transition-colors hover:border-border-hover disabled:cursor-not-allowed disabled:bg-fill disabled:text-faint max-md:h-11';

/** Each left-hand item picks its match from a list of the shuffled right-hand items. */
export function MatchingInput(props: InputProps<'matching'>) {
  const { question, onChange, disabled = false, labelledBy } = props;
  const id = useId();
  const matches = answerFor('matching', props.response)?.matches ?? {};
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-col gap-3">
      {question.prompts.map((prompt, index) => (
        <div key={prompt.id} className="grid gap-1.5 md:grid-cols-2 md:items-center md:gap-4">
          <label htmlFor={`${id}-${index}`} className="text-body text-fg">
            {prompt.text}
          </label>
          <select
            id={`${id}-${index}`}
            value={own(matches, prompt.id) ?? ''}
            disabled={disabled}
            className={selectClasses}
            onChange={(event) =>
              onChange({
                type: 'matching',
                matches: withEntry(matches, prompt.id, event.target.value || undefined),
              })
            }
          >
            <option value="">Choose a match</option>
            {question.matches.map((match) => (
              <option key={match.id} value={match.id}>
                {match.text}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

const cardClasses = (active: boolean) =>
  cn(
    'rounded border px-3 py-2 text-left text-body text-fg max-md:min-h-11',
    'disabled:cursor-not-allowed disabled:text-faint',
    active ? 'border-primary bg-fill' : 'border-border bg-bg hover:bg-fill-hover',
  );

/**
 * The shuffled right-hand items are cards to put next to the left-hand items: pick a card, then
 * the place it goes. This works with a mouse, a finger, the keyboard and a screen reader.
 */
export function DragMatchingInput(props: InputProps<'drag_matching'>) {
  const { question, onChange, disabled = false, labelledBy } = props;
  const [held, setHeld] = useState<Id | null>(null);
  const matches = answerFor('drag_matching', props.response)?.matches ?? {};
  const placed = new Set(Object.values(matches));
  const textOf = new Map(question.matches.map((match) => [match.id, match.text]));
  const place = (promptId: Id, matchId: Id | undefined) => {
    const others = Object.fromEntries(Object.entries(matches).filter(([, id]) => id !== matchId));
    onChange({ type: 'drag_matching', matches: withEntry(others, promptId, matchId) });
    setHeld(null);
  };
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-col gap-4">
      <p className="text-small text-muted">
        Pick a card, then pick where it goes. Pick a placed card to take it back.
      </p>
      <ul aria-label="Cards" className="flex flex-wrap gap-2">
        {question.matches
          .filter((match) => !placed.has(match.id))
          .map((match) => (
            <li key={match.id}>
              <button
                type="button"
                aria-pressed={held === match.id}
                disabled={disabled}
                onClick={() => setHeld(held === match.id ? null : match.id)}
                className={cardClasses(held === match.id)}
              >
                {match.text}
              </button>
            </li>
          ))}
      </ul>
      <ul aria-label="Places" className="flex flex-col gap-3">
        {question.prompts.map((prompt) => {
          const matchId = own(matches, prompt.id);
          const text = matchId === undefined ? undefined : textOf.get(matchId);
          return (
            <li key={prompt.id} className="grid gap-1.5 md:grid-cols-2 md:items-center md:gap-4">
              <span className="text-body text-fg">{prompt.text}</span>
              <button
                type="button"
                aria-label={`${prompt.text}: ${text ?? 'empty'}`}
                disabled={disabled || (text === undefined && held === null)}
                onClick={() => place(prompt.id, held ?? undefined)}
                className={cn(cardClasses(false), text === undefined && 'border-dashed text-muted')}
              >
                {text ?? 'Place here'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
