import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { useFieldControlProps } from './field-context';

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  const field = useFieldControlProps(props);
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'group inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-muted bg-bg text-primary-fg transition-colors hover:border-fg disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger data-[state=checked]:border-primary data-[state=indeterminate]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:bg-primary',
        className,
      )}
      {...props}
      {...field}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <Check
          aria-hidden
          strokeWidth={3}
          className="size-3 group-data-[state=indeterminate]:hidden"
        />
        <Minus
          aria-hidden
          strokeWidth={3}
          className="hidden size-3 group-data-[state=indeterminate]:block"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
