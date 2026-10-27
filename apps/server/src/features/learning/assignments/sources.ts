import type { Course } from '@carehub/learning';
import { getLiveCourse } from '../courses/service';
import type { Db, Tx } from '../db';
import type { AssignmentSources } from './service';
import { assignmentStore } from './store';

// Where assignments find other areas' data on the server. Paths and progress (B3) and group members
// (core, 0007 section 4.3, Oct 29) are stand-ins until they land: no paths, empty groups and no
// progress yet, so group assignments reach nobody and My learning shows assigned courses as not
// started.

/** The assignment sources on the server's database. */
export function postgresSources(db: Db | Tx): AssignmentSources {
  return {
    store: assignmentStore(db),
    async liveCourses(workspaceId, courseIds) {
      const found = await Promise.all(
        courseIds.map((courseId) => getLiveCourse(db, workspaceId, courseId)),
      );
      const live = new Map<string, Course>();
      courseIds.forEach((courseId, index) => {
        const entry = found[index];
        if (entry) live.set(courseId, entry.course);
      });
      return live;
    },
    pathCourses: async () => null,
    groupMembers: async () => new Map(),
    progress: async () => [],
  };
}
