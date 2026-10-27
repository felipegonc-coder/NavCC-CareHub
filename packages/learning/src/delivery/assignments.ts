import type { Id, IsoDate } from '../format/index';

/** A group of learners: one of the workspace's groups (GET /api/workspace/groups). */
export type LearningGroup = { id: Id; name: string; memberIds: readonly Id[] };

/** An assignment as a builder makes it: one course for some people and/or groups. */
export type CourseAssignment = {
  id: Id;
  courseId: Id;
  learnerIds?: readonly Id[];
  groupIds?: readonly Id[];
  dueDate?: IsoDate;
  required: boolean;
};

/** One learner's assignment of one course, after merging every assignment that reaches them. */
export type LearnerAssignment = {
  learnerId: Id;
  courseId: Id;
  dueDate?: IsoDate;
  required: boolean;
  /** The assignment the due date comes from (the first one when none has a due date). */
  assignmentId: Id;
  /** Every assignment merged into this one, in input order. */
  assignmentIds: Id[];
};

/**
 * Turns direct and group assignments into one assignment per learner and course. Group members are
 * read from `groups` on every call, so people added to a group later get its courses automatically.
 * When a learner gets a course more than once, the assignments merge: the earliest due date wins
 * and required wins over optional. Unknown group ids are ignored. The result is in first-seen
 * order.
 */
export function expandAssignments(
  assignments: readonly CourseAssignment[],
  groups: readonly LearningGroup[],
): LearnerAssignment[] {
  const members = new Map(groups.map((group) => [group.id, group.memberIds] as const));
  const merged = new Map<string, LearnerAssignment>();
  for (const assignment of assignments) {
    const learnerIds = new Set(assignment.learnerIds);
    for (const groupId of assignment.groupIds ?? []) {
      for (const learnerId of members.get(groupId) ?? []) learnerIds.add(learnerId);
    }
    for (const learnerId of learnerIds) {
      const key = JSON.stringify([learnerId, assignment.courseId]);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          learnerId,
          courseId: assignment.courseId,
          ...(assignment.dueDate !== undefined && { dueDate: assignment.dueDate }),
          required: assignment.required,
          assignmentId: assignment.id,
          assignmentIds: [assignment.id],
        });
        continue;
      }
      const { dueDate } = assignment;
      if (dueDate !== undefined && (existing.dueDate === undefined || dueDate < existing.dueDate)) {
        existing.dueDate = dueDate;
        existing.assignmentId = assignment.id;
      }
      existing.required ||= assignment.required;
      if (!existing.assignmentIds.includes(assignment.id))
        existing.assignmentIds.push(assignment.id);
    }
  }
  return [...merged.values()];
}
