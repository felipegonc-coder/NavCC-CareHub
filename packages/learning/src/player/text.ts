import type { Image, RichText } from '../format/index';

// Small text helpers for the player module. Not exported from the package.

/** Rich text as plain text: the runs of each paragraph joined, one line per paragraph. */
export function plainOf(text: RichText | undefined): string {
  if (!text) return '';
  return text.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');
}

/** The words a learner gets from a picture: its caption, and its description unless it is decorative. */
export function imageWords(image: Image | undefined): string[] {
  if (!image) return [];
  const words: string[] = [];
  if (image.caption) words.push(image.caption);
  if (!image.decorative && image.alt) words.push(image.alt);
  return words;
}
