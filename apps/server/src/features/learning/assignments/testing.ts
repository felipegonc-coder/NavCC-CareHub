import { randomUUID } from 'node:crypto';
import type { Course } from '@carehub/learning';
import type { AssignmentSources, CourseProgress } from './service';
import type { AssignmentRow, AssignmentStore, LearnerRow } from './store';

// Assignment sources in memory, for tests. Change `world` (groups, progress) between calls to act
// out what happens later.

export type MemoryStore = AssignmentStore & { rows: AssignmentRow[]; learnerRows: LearnerRow[] };

/** The assignment tables in memory; `now` stamps `createdAt`. */
export function memoryAssignmentStore(now: () => Date = () => new Date()): MemoryStore {
  const rows: AssignmentRow[] = [];
  const learnerRows: LearnerRow[] = [];
  return {
    rows,
    learnerRows,
    async insert(newRows) {
      const at = now();
      const added = newRows.map((row) => ({
        ...row,
        id: randomUUID(),
        createdAt: row.createdAt ?? at,
      }));
      rows.push(...added);
      return added.map((row) => ({ ...row }));
    },
    async list(workspaceId, { courseId, userId, pathId } = {}) {
      return rows.filter(
        (row) =>
          row.workspaceId === workspaceId &&
          (courseId === undefined || row.courseId === courseId) &&
          (pathId === undefined || row.pathId === pathId) &&
          (userId === undefined || row.userIds.includes(userId) || row.groupIds.length > 0),
      );
    },
    async remove(workspaceId, id) {
      const index = rows.findIndex((row) => row.workspaceId === workspaceId && row.id === id);
      const [removed] = index === -1 ? [] : rows.splice(index, 1);
      const kept = learnerRows.filter((learner) => learner.assignmentId !== removed?.id);
      learnerRows.splice(0, learnerRows.length, ...kept);
      return removed ? { ...removed } : null;
    },
    async learners(assignmentIds) {
      return learnerRows.filter((learner) => assignmentIds.includes(learner.assignmentId));
    },
    async addLearners(newRows) {
      for (const row of newRows) {
        const known = learnerRows.some(
          (learner) => learner.assignmentId === row.assignmentId && learner.userId === row.userId,
        );
        if (!known) learnerRows.push({ ...row });
      }
    },
  };
}

export type MemoryWorld = {
  /** Live courses, by id. */
  courses?: readonly Course[];
  /** Course ids per path id. */
  paths?: Record<string, string[]>;
  /** Member ids per group id. */
  groups?: Record<string, string[]>;
  progress?: CourseProgress[];
  /** Workspaces where an admin switched Learning off. */
  learningOff?: string[];
  now?: () => Date;
};

/** Sources over `world`, read on every call. */
export function memorySources(world: MemoryWorld = {}): AssignmentSources & { store: MemoryStore } {
  const store = memoryAssignmentStore(world.now);
  return {
    store,
    async liveCourses(_workspaceId, courseIds) {
      const courses = world.courses ?? [];
      return new Map(
        courses.filter((course) => courseIds.includes(course.id)).map((c) => [c.id, c]),
      );
    },
    async pathCourses(_workspaceId, pathId) {
      return world.paths?.[pathId] ?? null;
    },
    async groupMembers(_workspaceId, groupIds) {
      const groups = world.groups ?? {};
      return new Map(
        groupIds.flatMap((id) => {
          const members = groups[id];
          return members ? [[id, [...members]] as const] : [];
        }),
      );
    },
    async progress(_workspaceId, userIds) {
      return (world.progress ?? []).filter((entry) => userIds.includes(entry.userId));
    },
    async learningEnabled(workspaceId) {
      return !(world.learningOff ?? []).includes(workspaceId);
    },
  };
}

/** The one item in `items`; throws when there are none or more. */
export function only<T>(items: readonly T[]): T {
  const [item, ...rest] = items;
  if (item === undefined || rest.length > 0)
    throw new Error(`Expected 1 item, got ${items.length}.`);
  return item;
}
