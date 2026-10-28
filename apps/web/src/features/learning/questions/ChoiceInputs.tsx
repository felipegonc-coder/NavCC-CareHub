import type { Id } from '@carehub/learning';
import { cn } from '@carehub/ui';
import { useId } from 'react';
import { answerFor, type InputProps } from './answer';

type OptionCardProps = {
  type: 'radio' | 'checkbox';
  name: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange(): void;
};

/** One answer to pick: a card holding its radio button or checkbox, named by its text. */
function OptionCard({ type, name, label, checked, disabled, onChange }: OptionCardProps) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 rounded border p-3 text-body text-fg max-md:min-h-11',
        checked ? 'border-primary bg-fill' : 'border-border',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-fill-hover',
      )}
    >
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-1 accent-primary"
      />
      <span>{label}</span>
    </label>
  );
}

/** One option out of several, as radio buttons. */
export function SingleChoiceInput(props: InputProps<'single_choice'>) {
  const { question, onChange, disabled = false, labelledBy } = props;
  const name = useId();
  const picked = answerFor('single_choice', props.response)?.optionId;
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-col gap-2">
      {question.options.map((option) => (
        <OptionCard
          key={option.id}
          type="radio"
          name={name}
          label={option.text}
          checked={picked === option.id}
          disabled={disabled}
          onChange={() => onChange({ type: 'single_choice', optionId: option.id })}
        />
      ))}
    </div>
  );
}

/** Any number of options, as checkboxes. */
export function MultipleChoiceInput(props: InputProps<'multiple_choice'>) {
  const { question, onChange, disabled = false, labelledBy } = props;
  const name = useId();
  const picked = new Set(answerFor('multiple_choice', props.response)?.optionIds);
  const toggle = (id: Id) =>
    onChange({
      type: 'multiple_choice',
      optionIds: question.options
        .filter((option) => (option.id === id) !== picked.has(option.id))
        .map((option) => option.id),
    });
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-col gap-2">
      <p className="text-small text-muted">Choose all that apply.</p>
      {question.options.map((option) => (
        <OptionCard
          key={option.id}
          type="checkbox"
          name={name}
          label={option.text}
          checked={picked.has(option.id)}
          disabled={disabled}
          onChange={() => toggle(option.id)}
        />
      ))}
    </div>
  );
}

/** True or false, as two radio buttons. */
export function TrueFalseInput(props: InputProps<'true_false'>) {
  const { onChange, disabled = false, labelledBy } = props;
  const name = useId();
  const value = answerFor('true_false', props.response)?.value;
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-col gap-2">
      {[true, false].map((option) => (
        <OptionCard
          key={String(option)}
          type="radio"
          name={name}
          label={option ? 'True' : 'False'}
          checked={value === option}
          disabled={disabled}
          onChange={() => onChange({ type: 'true_false', value: option })}
        />
      ))}
    </div>
  );
}
