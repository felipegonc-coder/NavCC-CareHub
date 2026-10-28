import type { TextColor, TextMark } from '@carehub/databases';
import { cn, colorClasses, isColorName, type ColorName } from '@carehub/ui';

/**
 * How rich text is drawn, shared by the fill screen and the builder's editor so a description
 * looks the same in both (FM-07). Marks wrap the text innermost first, then the colour, then the
 * link.
 */
export const MARK_LOOKS: readonly {
  mark: TextMark;
  tag: 'code' | 'strong' | 'em' | 'u' | 's';
  className?: string;
}[] = [
  { mark: 'code', tag: 'code', className: 'rounded bg-fill px-1 font-mono text-small' },
  { mark: 'bold', tag: 'strong', className: 'font-semibold' },
  { mark: 'italic', tag: 'em' },
  { mark: 'underline', tag: 'u' },
  { mark: 'strike', tag: 's' },
];

export const LINK_CLASS = 'text-primary underline underline-offset-2 hover:text-primary-hover';

const BACKGROUND = '_background';

/** The colour's kit name and whether it's a background, or null for anything else. */
export function readColor(
  color: string,
): { name: Exclude<ColorName, 'default'>; background: boolean } | null {
  const background = color.endsWith(BACKGROUND);
  const name = background ? color.slice(0, -BACKGROUND.length) : color;
  return isColorName(name) && name !== 'default' ? { name, background } : null;
}

/** The kit class for a picked text or background colour. */
export function colorClass(color: TextColor | undefined): string | null {
  const read = color ? readColor(color) : null;
  if (!read) return null;
  const pair = colorClasses[read.name];
  return read.background ? cn(pair.bg, 'rounded px-0.5') : pair.text;
}
