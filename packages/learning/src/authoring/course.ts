import { LIMITS, presetFor } from '../format/index';
import type { Course, CourseSettings, CourseType, Image, RichText } from '../format/index';
import { courseIds, uniqueIds, withFreshIds } from './ids';
import { isBlankRichText } from './richtext';
import type { IdGen } from './types';
import { clampInt, copyTitle, sameJson, withOptional } from './types';

/** Renames the course (cut to 200 characters). A blank title is ignored, because the format needs one. */
export function renameCourse(course: Course, title: string): Course {
  const next = title.slice(0, LIMITS.title);
  return next.trim() === '' || next === course.title ? course : { ...course, title: next };
}

/** Sets the course-card summary (cut to 500 characters); blank removes it. */
export function setCourseSummary(course: Course, summary: string): Course {
  const next = summary.slice(0, LIMITS.shortText);
  return withOptional(course, 'summary', next.trim() === '' ? undefined : next);
}

/** Sets the start-page description; blank text removes it. */
export function setCourseDescription(course: Course, description: RichText): Course {
  return withOptional(
    course,
    'description',
    isBlankRichText(description) ? undefined : description,
  );
}

/** Sets or (with null) removes the cover picture. */
export function setCourseCover(course: Course, cover: Image | null): Course {
  return withOptional(course, 'cover', cover ?? undefined);
}

/** Sets the estimated time in minutes (1..600); null removes it. */
export function setEstimatedMinutes(course: Course, minutes: number | null): Course {
  return withOptional(
    course,
    'estimatedMinutes',
    minutes === null ? undefined : clampInt(minutes, 1, LIMITS.estimatedMinutes),
  );
}

/** Sets the catalog topics: trimmed, without blanks or repeats (ignoring case), at most 10 of 40 characters. */
export function setCourseTopics(course: Course, topics: string[]): Course {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of topics) {
    const topic = raw.trim().slice(0, LIMITS.topic).trim();
    const key = topic.toLocaleLowerCase();
    if (topic === '' || seen.has(key) || next.length >= LIMITS.topics) continue;
    seen.add(key);
    next.push(topic);
  }
  if (sameJson(next, course.topics ?? [])) return course;
  return withOptional(course, 'topics', next.length > 0 ? next : undefined);
}

/**
 * Standard courses need a quiz pass only when they have a quiz (preset table), so there `requireQuizPass`
 * follows whether the course has a quiz lesson. The lesson helpers call this when the first quiz is added or
 * the last one removed.
 */
export function syncQuizRule(course: Course): Course {
  const hasQuiz = course.lessons.some((lesson) => lesson.kind === 'quiz');
  const completion = course.settings.completion;
  if (course.type !== 'standard' || completion.requireQuizPass === hasQuiz) return course;
  return {
    ...course,
    settings: { ...course.settings, completion: { ...completion, requireQuizPass: hasQuiz } },
  };
}

/**
 * Changes the course type and applies that type's preset: lesson order, completion rules, certificate and every
 * quiz's settings (a quiz keeps its pool size and survey mode). Everything else the author set is kept: catalog
 * listing, minimum time, acknowledgement text, sidebar, labels and review reminder.
 */
export function changeCourseType(course: Course, type: CourseType): Course {
  if (type === course.type) return course;
  const preset = presetFor(type);
  const settings: CourseSettings = {
    ...preset.settings,
    ...course.settings,
    lessonOrder: preset.settings.lessonOrder,
    completion: { ...preset.settings.completion },
    certificate: { ...preset.settings.certificate },
  };
  if (
    settings.completion.requireAcknowledgement &&
    !settings.acknowledgement &&
    preset.settings.acknowledgement
  ) {
    settings.acknowledgement = { ...preset.settings.acknowledgement };
  }
  const lessons = course.lessons.map((lesson) => {
    if (lesson.kind !== 'quiz') return lesson;
    const { poolSize, mode } = lesson.settings;
    const quiz = {
      ...preset.quiz,
      ...(poolSize === undefined ? {} : { poolSize }),
      ...(mode === undefined ? {} : { mode }),
    };
    return { ...lesson, settings: quiz };
  });
  return syncQuizRule({ ...course, type, settings, lessons });
}

type LabelName = keyof NonNullable<CourseSettings['labels']>;

/** Changes to course settings. `null` removes an optional setting; numbers are kept to the format's ranges. */
export type CourseSettingsPatch = {
  lessonOrder?: CourseSettings['lessonOrder'];
  completion?: Partial<CourseSettings['completion']>;
  minimumCourseSeconds?: number | null;
  acknowledgement?: string | null;
  listed?: boolean;
  certificate?: { enabled?: boolean; validForMonths?: number | null };
  sidebar?: NonNullable<CourseSettings['sidebar']> | null;
  /** Renamed buttons; blank or null goes back to the standard wording. */
  labels?: Partial<Record<LabelName, string | null>>;
  reviewEveryMonths?: number | null;
};

const optionalInt = (value: number | null, min: number, max: number): number | undefined =>
  value === null ? undefined : clampInt(value, min, max);

/** Applies a settings patch. Returns the course itself when nothing changes. */
export function updateCourseSettings(course: Course, patch: CourseSettingsPatch): Course {
  const old = course.settings;
  let next: CourseSettings = { ...old };
  if (patch.lessonOrder) next.lessonOrder = patch.lessonOrder;
  if (patch.completion) next.completion = { ...old.completion, ...patch.completion };
  if (patch.listed !== undefined) next.catalog = { ...old.catalog, listed: patch.listed };
  if (patch.certificate) {
    const { enabled, validForMonths } = patch.certificate;
    const certificate = { ...old.certificate, ...(enabled === undefined ? {} : { enabled }) };
    next.certificate =
      validForMonths === undefined
        ? certificate
        : withOptional(
            certificate,
            'validForMonths',
            optionalInt(validForMonths, 1, LIMITS.certificateMonths),
          );
  }
  if (patch.minimumCourseSeconds !== undefined) {
    next = withOptional(
      next,
      'minimumCourseSeconds',
      optionalInt(patch.minimumCourseSeconds, 1, LIMITS.minimumCourseSeconds),
    );
  }
  if (patch.reviewEveryMonths !== undefined) {
    next = withOptional(
      next,
      'reviewEveryMonths',
      optionalInt(patch.reviewEveryMonths, 1, LIMITS.reviewEveryMonths),
    );
  }
  if (patch.acknowledgement !== undefined) {
    const statement = (patch.acknowledgement ?? '').slice(0, LIMITS.shortText);
    next = withOptional(
      next,
      'acknowledgement',
      statement.trim() === '' ? undefined : { statement },
    );
  }
  if (patch.sidebar !== undefined) next = withOptional(next, 'sidebar', patch.sidebar ?? undefined);
  if (patch.labels) {
    let labels: NonNullable<CourseSettings['labels']> = { ...old.labels };
    for (const [name, value] of Object.entries(patch.labels) as [
      LabelName,
      string | null | undefined,
    ][]) {
      const label = (value ?? '').slice(0, LIMITS.label);
      labels = withOptional(labels, name, label.trim() === '' ? undefined : label);
    }
    next = withOptional(next, 'labels', Object.keys(labels).length > 0 ? labels : undefined);
  }
  return sameJson(next, old) ? course : { ...course, settings: next };
}

/**
 * A copy of the course: "Copy of …", with a fresh course id and fresh lesson, block and question ids (links,
 * buttons and scenario jumps point at the copies). Publishing state lives outside the course document.
 */
export function duplicateCourse(course: Course, newId?: IdGen): Course {
  const ids = courseIds(course);
  const gen = uniqueIds(new Set([...ids, course.id]), newId);
  return {
    ...course,
    id: gen(),
    title: copyTitle(course.title, LIMITS.title),
    lessons: withFreshIds(course.lessons, ids, gen),
  };
}
