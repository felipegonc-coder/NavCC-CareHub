import { cn } from '@carehub/ui';
import { useId } from 'react';
import type { JSX } from 'react';

/** One option of {@link RadioChoices}. */
export type RadioChoice<T extends string> = { value: T; label: string; description?: string };

/** Props for {@link RadioChoices}. */
export type RadioChoicesProps<T extends string> = {
  /** Names the group. */
  legend: string;
  value: T;
  options: readonly RadioChoice<T>[];
  onChange(next: T): void;
  /** Side by side without descriptions (e.g. Computer or Phone), instead of one card per option. */
  compact?: boolean;
};

/** One choice out of a few, as radio buttons: arrow keys move between them, each named by its label. */
export function RadioChoices<T extends string>(props: RadioChoicesProps<T>): JSX.Element {
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-small font-medium text-fg">{props.legend}</legend>
      <div className={cn('flex gap-2', props.compact ? 'flex-wrap' : 'flex-col')}>
        {props.options.map((option, index) => {
          const checked = option.value === props.value;
          const about = option.description === undefined ? undefined : `${id}-${index}-about`;
          return (
            <label
              key={option.value}
              className={cn(
                'grid cursor-pointer grid-cols-control items-start gap-x-2 rounded border hover:bg-fill-hover',
                props.compact ? 'px-3 py-1.5' : 'gap-y-0.5 p-3',
                checked ? 'border-primary bg-fill' : 'border-border',
              )}
            >
              <input
                type="radio"
                name={id}
                className={cn('accent-primary', props.compact ? 'mt-0.5' : 'row-span-2 mt-1')}
                checked={checked}
                aria-labelledby={`${id}-${index}`}
                aria-describedby={about}
                onChange={() => props.onChange(option.value)}
              />
              <span id={`${id}-${index}`} className="text-small font-medium text-fg">
                {option.label}
              </span>
              {about && (
                <span id={about} className="text-small text-muted">
                  {option.description}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
