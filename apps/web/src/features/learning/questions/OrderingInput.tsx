import type { Id } from '@carehub/learning';
import { IconButton, VisuallyHidden } from '@carehub/ui';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { answerFor, type InputProps } from './answer';

type Move = { id: Id; step: -1 | 1 };

/** The shuffled items in a list, each moved up or down with its buttons. */
export function OrderingInput(props: InputProps<'ordering'>) {
  const { question, onChange, disabled = false, labelledBy } = props;
  const order = answerFor('ordering', props.response)?.order ?? [];
  const byId = new Map(question.items.map((item) => [item.id, item]));
  const shown = [
    ...new Set([...order.filter((id) => byId.has(id)), ...question.items.map((item) => item.id)]),
  ].flatMap((id) => byId.get(id) ?? []);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [moved, setMoved] = useState<Move | null>(null);
  useEffect(() => {
    if (!moved) return;
    const same = buttons.current.get(`${moved.id}:${moved.step}`);
    (same && !same.disabled ? same : buttons.current.get(`${moved.id}:${-moved.step}`))?.focus();
  }, [moved]);
  const move = (index: number, step: -1 | 1) => {
    const next = shown.map((item) => item.id);
    const [id] = next.splice(index, 1);
    if (id === undefined) return;
    next.splice(index + step, 0, id);
    onChange({ type: 'ordering', order: next });
    setMoved({ id, step });
  };
  const item = moved && byId.get(moved.id);
  const position = item ? shown.indexOf(item) + 1 : 0;
  return (
    <div className="flex flex-col gap-2">
      <ol aria-labelledby={labelledBy} className="flex flex-col gap-2">
        {shown.map((entry, index) => (
          <li
            key={entry.id}
            className="flex items-center gap-2 rounded border border-border bg-bg py-1 pl-3 pr-1"
          >
            <span aria-hidden className="text-small font-medium text-muted">
              {index + 1}
            </span>
            <span className="flex-1 text-body text-fg">{entry.text}</span>
            {([-1, 1] as const).map((step) => (
              <IconButton
                key={step}
                ref={(button: HTMLButtonElement | null) => {
                  if (button) buttons.current.set(`${entry.id}:${step}`, button);
                  else buttons.current.delete(`${entry.id}:${step}`);
                }}
                label={`Move "${entry.text}" ${step === -1 ? 'up' : 'down'}`}
                disabled={disabled || index + step < 0 || index + step >= shown.length}
                onClick={() => move(index, step)}
              >
                {step === -1 ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />}
              </IconButton>
            ))}
          </li>
        ))}
      </ol>
      <VisuallyHidden aria-live="polite">
        {item ? `"${item.text}" is now ${position} of ${shown.length}.` : ''}
      </VisuallyHidden>
    </div>
  );
}
