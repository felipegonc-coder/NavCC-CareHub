import { BUILT_IN_LAYERS, type LearningItem } from '@carehub/team-calendar-api';
import { addDays, type CivilDate } from '@carehub/team-time';
import { isLearningEnabled, listLearningDueDates, type LearningDueDate } from '../learning';

/** A course due date as a Learning layer item: all-day, read-only, opening the course. */
export const learningItemOf = (due: LearningDueDate): LearningItem => ({
  source: 'learning',
  id: `learning:${due.assignmentId}`,
  layerId: BUILT_IN_LAYERS.learning,
  title: due.title,
  allDay: true,
  start: due.dueDate,
  end: addDays(due.dueDate, 1),
  timeZone: null,
  canEdit: false,
  courseId: due.courseId,
  url: due.href,
});

/** The person's course due dates in [from, to), while Learning is on for the workspace. */
export async function learningItems(
  person: { id: string; workspaceId: string },
  from: CivilDate,
  to: CivilDate,
): Promise<LearningItem[]> {
  const { id: userId, workspaceId } = person;
  if (!(await isLearningEnabled(workspaceId))) return [];
  const last = addDays(to, -1);
  const dates = await listLearningDueDates({ userId, workspaceId, from, to: last });
  return dates.map(learningItemOf);
}
