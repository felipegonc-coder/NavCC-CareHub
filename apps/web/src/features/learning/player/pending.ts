import type {
  Id,
  LearnerCourseState,
  LessonProgress,
  PlayerCourse,
  ProgressEvent,
} from '@carehub/learning';

/**
 * The learner's state with the events still waiting to be sent laid over it, so the player answers
 * at once (a continue block opens, time counts, a lesson completes, the next one unlocks, the
 * sign-off is signed), even offline. The server's reply replaces it. Only what the player shows is
 * laid over, as the server applies it.
 */
export function withPending(
  course: Pick<PlayerCourse, 'lessons' | 'settings'>,
  state: LearnerCourseState,
  events: readonly ProgressEvent[],
): LearnerCourseState {
  if (events.length === 0) return state;
  const lessons = new Map(state.lessons.map((entry) => [entry.lessonId, entry]));
  const update = (lessonId: Id, change: (entry: LessonProgress) => LessonProgress) => {
    const entry = lessons.get(lessonId);
    if (entry && entry.status !== 'locked') lessons.set(lessonId, change(entry));
  };
  const started = (entry: LessonProgress) =>
    entry.status === 'not_started' ? 'in_progress' : entry.status;
  let acknowledgedAt = state.acknowledgedAt;
  for (const event of events) {
    switch (event.type) {
      case 'lesson_opened':
        update(event.lessonId, (entry) => ({
          ...entry,
          status: started(entry),
          lastOpenedAt: event.at,
        }));
        break;
      case 'block_completed':
      case 'knowledge_check_answered':
      case 'scenario_finished':
        update(event.lessonId, (entry) =>
          entry.completedBlockIds.includes(event.blockId)
            ? entry
            : {
                ...entry,
                status: started(entry),
                completedBlockIds: [...entry.completedBlockIds, event.blockId],
              },
        );
        break;
      case 'time_active':
        update(event.lessonId, (entry) => ({
          ...entry,
          activeSeconds: entry.activeSeconds + event.seconds,
        }));
        break;
      case 'lesson_completed':
        update(event.lessonId, (entry) =>
          entry.status === 'completed'
            ? entry
            : { ...entry, status: 'completed', completedAt: event.at },
        );
        unlockNext(course, lessons);
        break;
      case 'acknowledged':
        if (canSign(course, lessons, event.statement)) acknowledgedAt ??= event.at;
        break;
    }
  }
  return {
    ...state,
    acknowledgedAt,
    lessons: state.lessons.map((entry) => lessons.get(entry.lessonId) ?? entry),
  };
}

/**
 * Whether the server takes the sign-off: the course asks for one, this is its statement, and every
 * content lesson is completed.
 */
function canSign(
  course: Pick<PlayerCourse, 'lessons' | 'settings'>,
  lessons: Map<Id, LessonProgress>,
  statement: string,
): boolean {
  const { completion, acknowledgement } = course.settings;
  return (
    completion.requireAcknowledgement &&
    statement === (acknowledgement?.statement ?? statement) &&
    course.lessons.every(
      (lesson) => lesson.kind !== 'content' || lessons.get(lesson.id)?.status === 'completed',
    )
  );
}

/** In a course taken in order, opens the first locked lesson once all before it are done. */
function unlockNext(
  course: Pick<PlayerCourse, 'lessons' | 'settings'>,
  lessons: Map<Id, LessonProgress>,
) {
  if (course.settings.lessonOrder !== 'sequential') return;
  for (const lesson of course.lessons) {
    const entry = lessons.get(lesson.id);
    if (entry?.status === 'locked') lessons.set(lesson.id, { ...entry, status: 'not_started' });
    if (entry?.status !== 'completed') return;
  }
}
