import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from '../lib/cn';

export interface AvatarProps {
  /** Full name: read by screen readers and used for the initials. */
  name: string;
  src?: string | undefined;
  size?: 'sm' | 'md' | 'lg';
  /** Hide from screen readers when the name is already written next to it. */
  decorative?: boolean;
  className?: string;
}

const sizes = { sm: 'size-6 text-label', md: 'size-8 text-small', lg: 'size-10 text-body' };

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const last = words.length > 1 ? words.at(-1) : undefined;
  return [words.at(0), last].map((word) => word?.charAt(0).toUpperCase() ?? '').join('');
}

/** Round photo with an initials fallback while it loads or if it fails. */
export function Avatar({ name, src, size = 'md', decorative = false, className }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-fill-hover font-medium text-fg',
        sizes[size],
        className,
      )}
    >
      {src && <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" />}
      <AvatarPrimitive.Fallback>{initials(name)}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
