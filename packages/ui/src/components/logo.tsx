import type { ComponentProps } from 'react';

export interface LogoProps extends Omit<ComponentProps<'svg'>, 'children' | 'viewBox'> {
  /** Width and height in pixels. */
  size?: number;
  /** Accessible name. */
  title?: string;
  /** Hide from screen readers when "Care Hub" is written next to it. */
  decorative?: boolean;
}

/** The Care Hub mark: a white "C" on a dark rounded square. Brand colours, the same in both themes. */
export function Logo({ size = 32, title = 'Care Hub', decorative = false, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative || undefined}
      focusable="false"
      {...props}
    >
      <rect width="32" height="32" rx="8" fill="#191919" />
      <path d="M22.5 7.38A9.5 9.5 0 1 0 22.5 24.62V19A5 5 0 1 1 22.5 13Z" fill="#FFFFFF" />
    </svg>
  );
}
