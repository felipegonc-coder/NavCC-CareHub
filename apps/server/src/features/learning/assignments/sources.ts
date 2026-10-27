import type { Db, Tx } from '../../../db';
import type { AssignmentSources } from './service';
import { assignmentStore } from './store';

// Where assignments find other areas' data on the server. Stand-ins until those land on main: live
// courses (the courses server, B1, #111), paths and progress (B3), group members (core, 0007
// section 4.3, Oct 29) and workspace settings (core's features/workspaces, 0007 section 2.3). So
// for now no course is live (nothing can be assigned yet) and Learning is on in every workspace.

/** The assignment sources on the server's database. */
export function postgresSources(db: Db | Tx): AssignmentSources {
  return {
    store: assignmentStore(db),
    liveCourses: async () => new Map(),
    pathCourses: async () => null,
    groupMembers: async () => new Map(),
    progress: async () => [],
    learningEnabled: async () => true,
  };
}
