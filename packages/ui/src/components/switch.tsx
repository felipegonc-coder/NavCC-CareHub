import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { useFieldControlProps } from './field-context';

/** On/off. Off is an outline with a grey dot, so it reads without colour. */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  const field = useFieldControlProps(props);
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-muted bg-bg p-px transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
      {...field}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-muted transition-transform data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary-fg" />
    </SwitchPrimitive.Root>
  );
}
