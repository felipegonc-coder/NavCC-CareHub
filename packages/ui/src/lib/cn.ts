import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { layers, outlineOffsets, shadows, typeScale } from '../scale';

// Teach tailwind-merge the preset's own names so `text-small` and `text-muted` don't clash.
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: Object.keys(typeScale) }],
      shadow: [{ shadow: Object.keys(shadows) }],
      'max-w': [{ 'max-w': ['page', 'dialog', 'toast'] }],
      'outline-offset': [{ 'outline-offset': Object.keys(outlineOffsets) }],
      z: [{ z: Object.keys(layers) }],
    },
    theme: { spacing: ['sidebar'] },
  },
});

/** Joins class names; when Tailwind classes conflict, the later one wins. */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
