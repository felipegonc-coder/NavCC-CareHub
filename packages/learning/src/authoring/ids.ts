import { newId as randomId } from '../format/index';
import type { Block, Course, Id, Lesson } from '../format/index';
import type { IdGen } from './types';

/** Wraps `gen` so it never returns an id in `taken`; every id it returns is added to `taken`. */
export function uniqueIds(taken: Set<Id>, gen: IdGen = randomId): IdGen {
  return () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = gen();
      if (!taken.has(id)) {
        taken.add(id);
        return id;
      }
    }
    throw new Error('The id generator keeps returning ids that are already in use.');
  };
}

/** The block's id, plus the question id of a knowledge check. */
export function blockIds(block: Block): Id[] {
  return block.type === 'knowledge_check' ? [block.id, block.question.id] : [block.id];
}

/** The lesson's id plus every block and question id inside it. */
export function lessonIds(lesson: Lesson): Id[] {
  return lesson.kind === 'content'
    ? [lesson.id, ...lesson.blocks.flatMap(blockIds)]
    : [lesson.id, ...lesson.questions.map((question) => question.id)];
}

/** Lesson, block and question ids in use (they must be unique across the course). */
export function courseIds(course: Course): Set<Id> {
  return new Set(course.lessons.flatMap(lessonIds));
}

// Lessons, blocks and questions sit under these keys; every other `id` is nested (unique only within its parent).
const TOP_KEYS = new Set(['lessons', 'blocks', 'questions', 'question']);
// Links, buttons and scenario jumps point at lessons and blocks with these keys.
const TOP_REFS = new Set(['lessonId', 'blockId']);

function remap(value: unknown, ids: ReadonlyMap<Id, Id>, top: boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => remap(item, ids, top));
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    const isRef = TOP_REFS.has(key) || (key === 'id' && top);
    out[key] =
      isRef && typeof v === 'string' ? (ids.get(v) ?? v) : remap(v, ids, TOP_KEYS.has(key));
  }
  return out;
}

/**
 * A deep copy of a lesson, block or question (or a list of them) where the given lesson, block and question ids
 * are replaced by fresh ones from `gen`, including links, buttons and scenario jumps that point at them.
 * Nested ids (options, pairs, scenes…) only need to be unique within their parent, so they are kept.
 */
export function withFreshIds<T>(item: T, ids: Iterable<Id>, gen: IdGen): T {
  const map = new Map<Id, Id>();
  for (const id of ids) if (!map.has(id)) map.set(id, gen());
  return remap(item, map, true) as T;
}

/** `item` itself when none of `ids` is in `taken`, otherwise a copy with fresh ids. */
export function withFreeIds<T>(item: T, ids: Id[], taken: Set<Id>, gen?: IdGen): T {
  return ids.some((id) => taken.has(id)) ? withFreshIds(item, ids, uniqueIds(taken, gen)) : item;
}
