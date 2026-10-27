import { cn } from '@carehub/ui';

type ProgressBarProps = {
  /** Done, from 0 to 100. */
  percent: number;
  /** What the bar measures, for screen readers: "Course progress". */
  label: string;
  className?: string;
};

/** How much of a course is done, as a bar that screen readers read as a percentage. */
export function ProgressBar({ percent, label, className }: ProgressBarProps) {
  const value = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={`${value}% done`}
      className={cn('h-2 overflow-hidden rounded-full bg-border', className)}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
    </div>
  );
}

/** Lessons completed out of all lessons, as a whole percentage, rounded down as on the server. */
export function outlinePercent(outline: { completed: number; total: number }): number {
  return outline.total === 0 ? 0 : Math.floor((outline.completed / outline.total) * 100);
}
