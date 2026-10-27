import type { Course } from '@carehub/learning';
import type { Db, Tx } from '../../../db';
import { getCourseVersion, getLiveCourse } from '../courses/service';

// Where progress reads published course versions: the courses server's `getLiveCourse` and
// `getCourseVersion` (B1, decision 0311). Tests bind versions of their own.

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

// The courses server imports progress too (the publish hook and runVersion), so its functions are
// looked up when called, not when this file loads.
const PUBLISHED: CourseVersions = {
  live: (db, workspaceId, courseId) => getLiveCourse(db, workspaceId, courseId),
  async version(db, workspaceId, courseId, version) {
    const course = await getCourseVersion(db, workspaceId, courseId, version);
    return course && { course, version };
  },
};

let bound: CourseVersions = PUBLISHED;

/** Sets where progress reads course versions; null puts back the courses server. */
export function bindCourseVersions(versions: CourseVersions | null): void {
  bound = versions ?? PUBLISHED;
}

/** Where progress reads course versions now (bindCourseVersions). */
export function courseVersions(): CourseVersions {
  return bound;
}
