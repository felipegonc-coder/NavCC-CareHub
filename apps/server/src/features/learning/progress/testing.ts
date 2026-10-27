import type { Course } from '@carehub/learning';
import { bindCourseVersions, type CourseVersions, type PublishedCourse } from './courses';

/** Course versions kept in memory, standing in for the courses server in tests. */
export type MemoryCourseVersions = CourseVersions & {
  /** Publishes `course` as its next version in the workspace, and returns the version. */
  publish(workspaceId: string, course: Course): number;
};

/** Binds course versions kept in memory until `unbind` is called (tests only). */
export function bindMemoryCourseVersions(): {
  courses: MemoryCourseVersions;
  unbind: () => void;
} {
  const published = new Map<string, Course[]>();
  const versionsOf = (workspaceId: string, courseId: string) =>
    published.get(`${workspaceId} ${courseId}`) ?? [];
  const found = (list: readonly Course[], version: number): PublishedCourse | null => {
    const course = list[version - 1];
    return course ? { course: structuredClone(course), version } : null;
  };
  const courses: MemoryCourseVersions = {
    live: async (_db, workspaceId, courseId) => {
      const list = versionsOf(workspaceId, courseId);
      return found(list, list.length);
    },
    version: async (_db, workspaceId, courseId, version) =>
      found(versionsOf(workspaceId, courseId), version),
    publish: (workspaceId, course) => {
      const list = [...versionsOf(workspaceId, course.id), structuredClone(course)];
      published.set(`${workspaceId} ${course.id}`, list);
      return list.length;
    },
  };
  bindCourseVersions(courses);
  return { courses, unbind: () => bindCourseVersions(null) };
}
