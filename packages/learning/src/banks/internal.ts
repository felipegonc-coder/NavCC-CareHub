import type { Id } from '../format/index';

// Helpers shared inside the banks module. Not exported from the package.

/** How publish problems name a lesson, as `checkPublishable` does: `Lesson 3 "Final quiz"`, or `Lesson 3` without a title. */
export function lessonName(index: number, title: string): string {
  const trimmed = title.trim();
  return trimmed ? `Lesson ${index + 1} "${trimmed}"` : `Lesson ${index + 1}`;
}

const MAX_ID_LENGTH = 64;

/**
 * Hands out ids that aren't in `used` yet and records them: `wanted` itself when it's free, otherwise
 * `wanted-2`, `wanted-3`, … (shortened to fit 64 characters). The same inputs always give the same ids.
 */
export function idAllocator(used: Set<string>): (wanted: Id) => Id {
  return (wanted) => {
    let id = wanted;
    for (let n = 2; used.has(id); n++) {
      const suffix = `-${n}`;
      id = wanted.slice(0, MAX_ID_LENGTH - suffix.length) + suffix;
    }
    used.add(id);
    return id;
  };
}
