import type { Course } from '@carehub/learning';
import type { Db, Tx } from '../../../db';
import { getLiveCourse } from '../courses/service';
import { listCourseStates } from '../progress/service';
import type { AssignmentSources } from './service';
import { assignmentStore } from './store';

// Where assignments find other areas' data on the server: live courses from the courses server
// (B1) and progress from the progress server (B3). Stand-ins until the rest land on main: paths
// (B3), group members (core, 0007 section 4.3, Oct 29) and workspace settings (core's
// features/workspaces, 0007 section 2.3). So for now no path can be assigned, groups have no
// members and Learning is on in every workspace.

/** The live version of each of these courses that has one (archived courses too). */
async function liveCourses(
  db: Db | Tx,
  workspaceId: string,
  courseIds: readonly string[],
): Promise<Map<string, Course>> {
  const live = new Map<string, Course>();
  // One at a time: a transaction runs one query at a time anyway.
  for (const courseId of courseIds) {
    const found = await getLiveCourse(db, workspaceId, courseId);
    if (found) live.set(courseId, found.course);
  }
  return live;
}

/** The assignment sources on the server's database. */
export function postgresSources(db: Db | Tx): AssignmentSources {
  return {
    store: assignmentStore(db),
    liveCourses: (workspaceId, courseIds) => liveCourses(db, workspaceId, courseIds),
    pathCourses: async () => null,
    groupMembers: async () => new Map(),
    progress: (workspaceId, userIds) => listCourseStates(db, { workspaceId, userIds }),
    learningEnabled: async () => true,
  };
}
