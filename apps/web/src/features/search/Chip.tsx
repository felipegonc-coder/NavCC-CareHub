import { buttonClasses, cn } from '@carehub/ui';

// What the filter chips under the search box look like (spec 2).

export const chipClasses = (on: boolean) =>
  buttonClasses({
    variant: 'secondary',
    size: 'sm',
    className: cn('rounded-full', on && 'border-primary text-primary'),
  });

export function ToggleChip(props: { label: string; on: boolean; onToggle: (on: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={props.on}
      className={chipClasses(props.on)}
      onClick={() => props.onToggle(!props.on)}
    >
      {props.label}
    </button>
  );
}
