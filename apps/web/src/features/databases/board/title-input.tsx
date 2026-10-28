import { useEffect, useRef } from 'react';
import { cn, Input } from '@carehub/ui';
import { CELL_TEXT } from '../cells';

/** The title of a new card or line, typed in place: Enter or leaving saves it, Escape keeps "Untitled". */
export function TitleInput({
  label,
  initial,
  onDone,
  className,
}: {
  label: string;
  initial: string;
  onDone(title: string | null): void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const finish = (title: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(title);
  };
  return (
    <Input
      ref={input}
      aria-label={label}
      defaultValue={initial}
      placeholder={CELL_TEXT.untitled}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(event.currentTarget.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
      className={cn('h-8 min-w-0 flex-1', className)}
    />
  );
}
