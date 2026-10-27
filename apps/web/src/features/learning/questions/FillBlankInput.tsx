import { LIMITS } from '@carehub/learning';
import { Input } from '@carehub/ui';
import { answerFor, own, withEntry, type InputProps } from './answer';

/** The text with a field for each blank, in reading order. */
export function FillBlankInput(props: InputProps<'fill_blank'>) {
  const { question, onChange, disabled = false, labelledBy } = props;
  const blanks = answerFor('fill_blank', props.response)?.blanks ?? {};
  const count = question.parts.filter((part) => part.kind === 'blank').length;
  let number = 0;
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="flex flex-wrap items-center gap-x-1 gap-y-2 text-body text-fg"
    >
      {question.parts.map((part, index) => {
        if (part.kind === 'text') {
          return (
            <span key={index} className="whitespace-pre-wrap">
              {part.text}
            </span>
          );
        }
        number += 1;
        return (
          <Input
            key={part.id}
            aria-label={count === 1 ? 'Blank' : `Blank ${number} of ${count}`}
            value={own(blanks, part.id) ?? ''}
            maxLength={LIMITS.blankResponse}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            className="w-40"
            onChange={(event) =>
              onChange({
                type: 'fill_blank',
                blanks: withEntry(blanks, part.id, event.target.value || undefined),
              })
            }
          />
        );
      })}
    </div>
  );
}
