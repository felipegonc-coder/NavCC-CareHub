import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useId } from 'react';
import { cn } from '../lib/cn';
import { isTheme, useTheme, type Theme } from './theme';

const options: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export interface ThemeSwitchProps {
  /** Icons only; screen readers still hear the names. */
  compact?: boolean;
  className?: string;
}

/**
 * Light, dark, or follow the device. Three native radio buttons, so Tab reaches the chosen one
 * and the arrow keys change it, with no script of our own.
 */
export function ThemeSwitch({ compact = false, className }: ThemeSwitchProps) {
  const { theme, setTheme } = useTheme();
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        'inline-flex items-center gap-0.5 rounded border border-border bg-bg p-0.5',
        className,
      )}
    >
      {options.map(({ value, label, icon: Icon }) => (
        <label
          key={value}
          title={compact ? label : undefined}
          className={cn(
            'inline-flex h-7 cursor-pointer max-md:h-11 select-none items-center gap-1.5 rounded-[6px] px-2 text-small text-muted',
            '[&:not(:has(:checked)):hover]:bg-fill-hover [&:not(:has(:checked)):hover]:text-fg',
            'has-[:checked]:bg-primary has-[:checked]:text-primary-fg',
            'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
          )}
        >
          <input
            type="radio"
            name={name}
            value={value}
            checked={theme === value}
            onChange={(event) => {
              if (isTheme(event.target.value)) setTheme(event.target.value);
            }}
            className="sr-only"
          />
          <Icon aria-hidden className="size-4 shrink-0" />
          {compact ? <span className="sr-only">{label}</span> : label}
        </label>
      ))}
    </div>
  );
}
