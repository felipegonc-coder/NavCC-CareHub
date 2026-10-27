import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { controlClasses } from './classes';
import { useFieldControlProps } from './field-context';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  const field = useFieldControlProps(props);
  return (
    <input className={cn(controlClasses, 'h-9 max-md:h-11', className)} {...props} {...field} />
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  const field = useFieldControlProps(props);
  return (
    <textarea className={cn(controlClasses, 'min-h-20 py-2', className)} {...props} {...field} />
  );
}
