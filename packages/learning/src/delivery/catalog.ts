import type { Course } from '../format/index';

/** The course fields the catalog uses. A full `Course` fits. */
export type CatalogCourse = Pick<Course, 'id' | 'title' | 'summary' | 'topics'> & {
  settings: { catalog: { listed: boolean } };
};

/** Lower case without accents, so "Résumé" and "resume" compare equal. */
function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * The listed courses that match a search, in input order. Every word of `query` must appear in the
 * title, summary or topics, ignoring case and accents; an empty query matches every listed course.
 * `topic` keeps only courses with exactly that topic. Pass published courses only.
 */
export function searchCatalog<C extends CatalogCourse>(
  courses: readonly C[],
  query: string,
  topic?: string,
): C[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return courses.filter((course) => {
    if (!course.settings.catalog.listed) return false;
    if (topic && !course.topics?.includes(topic)) return false;
    const text = fold([course.title, course.summary ?? '', ...(course.topics ?? [])].join('\n'));
    return words.every((word) => text.includes(word));
  });
}
