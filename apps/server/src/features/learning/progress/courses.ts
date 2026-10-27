import type { Course } from '@carehub/learning';
import type { Db, Tx } from '../../../db';

// Where progress reads published course versions. They belong to the courses server (B1, #111):
// `getLiveCourse` and `getCourseVersion` (decision 0311) are bound here once it is on main.
// Until then nothing is published, so every progress route answers 404, as assignments do with
// their stand-in sources. Tests bind versions of their own.

/** One published version of a course: the course as published and its version number. */
export type PublishedCourse = { course: Course; version: number };

/** The published versions of courses, as progress reads them. */
export type CourseVersions = {
  /** The live version of a course, or null when it has none. */
  live(db: Db | Tx, workspaceId: string, courseId: string): Promise<PublishedCourse | null>;
  /** One published version of a course, or null when there is no such version. */
  version(
    db: Db | Tx,
    workspaceId: string,
    courseId: string,
    version: number,
  ): Promise<PublishedCourse | null>;
};

const NOTHING_PUBLISHED: CourseVersions = { live: async () => null, version: async () => null };

let bound: CourseVersions = NOTHING_PUBLISHED;

/** Sets where progress reads course versions; null puts back the stand-in, with none. */
export function bindCourseVersions(versions: CourseVersions | null): void {
  bound = versions ?? NOTHING_PUBLISHED;
}

/** Where progress reads course versions now (bindCourseVersions). */
export function courseVersions(): CourseVersions {
  return bound;
}
