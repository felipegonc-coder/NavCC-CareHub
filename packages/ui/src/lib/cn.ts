import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge the preset's custom sizes so `text-small` and `text-muted` don't clash.
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['title', 'body', 'small', 'label'] }],
      shadow: [{ shadow: ['menu', 'dialog'] }],
      'max-w': [{ 'max-w': ['page'] }],
    },
    theme: { spacing: ['sidebar'] },
  },
});

/** Joins class names; when Tailwind classes conflict, the later one wins. */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
