// Who may see and change a course, for the other areas (media files, reviews). A stub from the base PR: nobody,
// until the courses server (B1, PR 4) fills it in from course visibility and `learning.build`.

/** Whether the person can open the course (its live version, or the draft when they build it). */
export const canSeeCourse: (userId: string, courseId: string) => Promise<boolean> = async () =>
  false;

/** Whether the person can change the course's draft. */
export const canEditCourse: (userId: string, courseId: string) => Promise<boolean> = async () =>
  false;
