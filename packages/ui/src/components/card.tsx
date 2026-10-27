import { createElement, type ComponentProps } from 'react';
import { cn } from '../lib/cn';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('rounded border border-border bg-bg p-4 text-fg', className)} {...props} />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1', className)} {...props} />;
}

export interface CardTitleProps extends ComponentProps<'h3'> {
  /** Heading level that fits the page outline. */
  as?: 'h2' | 'h3' | 'h4';
}

export function CardTitle({ as = 'h3', className, ...props }: CardTitleProps) {
  return createElement(as, { className: cn('text-body font-semibold', className), ...props });
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-small text-muted', className)} {...props} />;
}
