import { LoaderCircle } from 'lucide-react';
import { cn } from '../lib/cn';

export interface SpinnerProps {
  /** Read out by screen readers. */
  label?: string;
  /** Hide from screen readers when something else already says it is busy. */
  decorative?: boolean;
  className?: string;
}

export function Spinner({ label = 'Loading', decorative = false, className }: SpinnerProps) {
  const icon = <LoaderCircle aria-hidden className={cn('size-4 animate-spin', className)} />;
  if (decorative) return icon;
  return (
    <span role="status" className="inline-flex items-center">
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}
