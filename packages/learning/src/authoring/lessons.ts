import { LIMITS, newId as randomId, presetFor } from '../format/index';
import type { Course, Id, Image, Lesson, QuizSettings, RichText } from '../format/index';
import { insertItem, moveItemById, removeItemById, updateItemById } from './arrays';
import { syncQuizRule } from './course';
import { courseIds, lessonIds, uniqueIds, withFreeIds, withFreshIds } from './ids';
import { isBlankRichText } from './richtext';
import type { IdGen } from './types';
import { clampInt, copyTitle, sameJson, withOptional } from './types';

/** A new empty lesson with a fresh id: "Lesson N", or "Quiz" with the quiz settings of the course type's preset. */
export function newLesson(course: Course, kind: Lesson['kind'], newId: IdGen = randomId): Lesson {
  const id = uniqueIds(courseIds(course), newId)();
  const count = course.lessons.filter((lesson) => lesson.kind === kind).length;
  if (kind === 'content') return { id, kind, title: `Lesson ${count + 1}`, blocks: [] };
  return {
    id,
    kind,
    title: count > 0 ? `Quiz ${count + 1}` : 'Quiz',
    settings: { ...presetFor(course.type).quiz },
    questions: [],
  };
}

/** Inserts a lesson at `index` (default: the end), up to 100 lessons. Ids already in use are replaced. */
export function insertLesson(
  course: Course,
  lesson: Lesson,
  index = course.lessons.length,
  newId?: IdGen,
): Course {
  if (course.lessons.length >= LIMITS.lessons) return course;
  const safe = withFreeIds(lesson, lessonIds(lesson), courseIds(course), newId);
  return syncQuizRule({ ...course, lessons: insertItem(course.lessons, index, safe) });
}

/** Replaces the lesson with `lessonId` by `update(lesson)`. */
export function updateLesson(
  course: Course,
  lessonId: Id,
  update: (lesson: Lesson) => Lesson,
): Course {
  const lessons = updateItemById(course.lessons, lessonId, update);
  return lessons === course.lessons ? course : { ...course, lessons };
}

/** Renames a lesson (cut to 200 characters); a blank title is ignored. */
export function renameLesson(course: Course, lessonId: Id, title: string): Course {
  const next = title.slice(0, LIMITS.title);
  return next.trim() === ''
    ? course
    : updateLesson(course, lessonId, (l) => (l.title === next ? l : { ...l, title: next }));
}

/** Copies a lesson right after itself: "Copy of …", with fresh lesson, block and question ids. */
export function duplicateLesson(course: Course, lessonId: Id, newId?: IdGen): Course {
  const index = course.lessons.findIndex((lesson) => lesson.id === lessonId);
  const lesson = course.lessons[index];
  if (!lesson || course.lessons.length >= LIMITS.lessons) return course;
  const copy = withFreshIds(lesson, lessonIds(lesson), uniqueIds(courseIds(course), newId));
  return {
    ...course,
    lessons: insertItem(course.lessons, index + 1, {
      ...copy,
      title: copyTitle(lesson.title, LIMITS.title),
    }),
  };
}

/** Deletes a lesson and everything in it. */
export function deleteLesson(course: Course, lessonId: Id): Course {
  const lessons = removeItemById(course.lessons, lessonId);
  return lessons === course.lessons ? course : syncQuizRule({ ...course, lessons });
}

/** Moves a lesson so it ends up at `toIndex` (drag and drop). */
export function moveLesson(course: Course, lessonId: Id, toIndex: number): Course {
  const lessons = moveItemById(course.lessons, lessonId, toIndex);
  return lessons === course.lessons ? course : { ...course, lessons };
}

/** Moves a lesson up (-1) or down (+1) one place (keyboard and move buttons). */
export function moveLessonBy(course: Course, lessonId: Id, delta: number): Course {
  const index = course.lessons.findIndex((lesson) => lesson.id === lessonId);
  return index < 0 ? course : moveLesson(course, lessonId, index + delta);
}

/** Changes to a lesson's details; `null` removes one. Minimum time (content lessons) is 1..3600 seconds. */
export type LessonPatch = {
  icon?: string | null;
  headerImage?: Image | null;
  minimumSeconds?: number | null;
  intro?: RichText;
};

/** Sets a lesson's icon and, for content lessons, header picture and minimum time, or a quiz's intro text. */
export function updateLessonDetails(course: Course, lessonId: Id, patch: LessonPatch): Course {
  return updateLesson(course, lessonId, (lesson) => {
    if (lesson.kind === 'quiz') {
      return patch.intro === undefined
        ? lesson
        : withOptional(lesson, 'intro', isBlankRichText(patch.intro) ? undefined : patch.intro);
    }
    let next = lesson;
    if (patch.icon !== undefined) {
      const icon = (patch.icon ?? '').trim().slice(0, 32);
      next = withOptional(next, 'icon', icon === '' ? undefined : icon);
    }
    if (patch.headerImage !== undefined)
      next = withOptional(next, 'headerImage', patch.headerImage ?? undefined);
    if (patch.minimumSeconds !== undefined) {
      const seconds =
        patch.minimumSeconds === null
          ? undefined
          : clampInt(patch.minimumSeconds, 1, LIMITS.minimumLessonSeconds);
      next = withOptional(next, 'minimumSeconds', seconds);
    }
    return next;
  });
}

/** Changes to quiz settings; `poolSize: null` turns the question pool off and `mode: null` makes the quiz graded. */
export type QuizSettingsPatch = Partial<Omit<QuizSettings, 'poolSize' | 'mode'>> & {
  poolSize?: number | null;
  mode?: NonNullable<QuizSettings['mode']> | null;
};

/** Updates a quiz's settings: pass mark 0..100, tries 1..20 or null (unlimited), shuffling, pool, answers, mode. */
export function updateQuizSettings(course: Course, lessonId: Id, patch: QuizSettingsPatch): Course {
  return updateLesson(course, lessonId, (lesson) => {
    if (lesson.kind !== 'quiz') return lesson;
    const old = lesson.settings;
    const { poolSize, mode, passMark, maxAttempts, ...flags } = patch;
    let next: QuizSettings = { ...old, ...flags };
    if (passMark !== undefined) next.passMark = clampInt(passMark, 0, 100) ?? old.passMark;
    if (maxAttempts !== undefined)
      next.maxAttempts =
        maxAttempts === null
          ? null
          : (clampInt(maxAttempts, 1, LIMITS.maxAttempts) ?? old.maxAttempts);
    if (poolSize !== undefined)
      next = withOptional(
        next,
        'poolSize',
        poolSize === null ? undefined : clampInt(poolSize, 1, LIMITS.questions),
      );
    if (mode !== undefined) next = withOptional(next, 'mode', mode === 'survey' ? mode : undefined);
    return sameJson(next, old) ? lesson : { ...lesson, settings: next };
  });
}
