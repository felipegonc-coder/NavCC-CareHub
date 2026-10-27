import { useId } from 'react';

export type ChoiceGroupProps<T extends string> = {
  legend: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(next: T): void;
};

/** One choice out of a few, as radio buttons (arrow keys move between them). */
export function ChoiceGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
}: ChoiceGroupProps<T>) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-small font-medium text-fg">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-small text-fg">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="size-4 accent-primary"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
