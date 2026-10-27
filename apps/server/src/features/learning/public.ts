// Learning's server functions for other lanes: Team tools' Calendar layer and Home (docs/learning/api.md).
// Stubs from the base PR; the assignments area (B4) fills them in. Each result is already limited to what
// that person may see.

/** A due date on someone's calendar. `dueDate` is a calendar day, `YYYY-MM-DD`. */
export type LearningDueDate = {
  assignmentId: string;
  courseId: string;
  title: string;
  dueDate: string;
  href: string;
};

/** A course on someone's Home. `progressPercent` is 0 to 100. */
export type MyLearningItem = {
  courseId: string;
  title: string;
  dueDate: string | null;
  overdue: boolean;
  progressPercent: number;
  href: string;
};

/** Whether Learning is switched on for the workspace. */
export const isLearningEnabled: (workspaceId: string) => Promise<boolean> = async () => false;

/** The person's Learning due dates from `from` to `to` (calendar days, both included). */
export const listLearningDueDates: (query: {
  userId: string;
  workspaceId: string;
  from: string;
  to: string;
}) => Promise<LearningDueDate[]> = async () => [];

/** The person's current courses for Home, most urgent first, at most `limit`. */
export const listMyLearning: (query: {
  userId: string;
  workspaceId: string;
  limit: number;
}) => Promise<MyLearningItem[]> = async () => [];
