import { CourseFileSchema, CourseSchema, LearningPathSchema } from './course';
import type { Course, CourseFile, LearningPath } from './course';
import type { FormatIssue } from './issues';
import { parseWith } from './issues';
import { COURSE_MIGRATIONS, LEARNING_PATH_MIGRATIONS, runMigrations } from './migrations';
import type { Migration } from './migrations';
import {
  COURSE_FILE_FORMAT,
  COURSE_FORMAT_VERSION,
  LEARNING_PATH_FORMAT_VERSION,
} from './primitives';

export type ParseOptions = { migrations?: readonly Migration[] };
export type ParseCourseResult =
  { ok: true; course: Course; migratedFrom?: number } | { ok: false; issues: FormatIssue[] };
export type ParseCourseFileResult =
  { ok: true; file: CourseFile; migratedFrom?: number } | { ok: false; issues: FormatIssue[] };
export type ParseLearningPathResult =
  | { ok: true; learningPath: LearningPath; migratedFrom?: number }
  | { ok: false; issues: FormatIssue[] };

const failed = (): { ok: false; issues: FormatIssue[] } => ({
  ok: false,
  issues: [{ path: '', message: 'This could not be read.' }],
});

/** Reads an untrusted course: runs migrations for older `formatVersion`s, then validates. Never throws. */
export function parseCourse(raw: unknown, options: ParseOptions = {}): ParseCourseResult {
  try {
    const migrated = runMigrations(
      raw,
      COURSE_FORMAT_VERSION,
      options.migrations ?? COURSE_MIGRATIONS,
      'course',
    );
    if (!migrated.ok) return migrated;
    const parsed = parseWith(CourseSchema, migrated.value);
    if (!parsed.ok) return parsed;
    return migrated.migratedFrom === undefined
      ? { ok: true, course: parsed.value }
      : { ok: true, course: parsed.value, migratedFrom: migrated.migratedFrom };
  } catch {
    return failed();
  }
}

/** Reads an imported course file (`{ format, exportedAt?, course }`), migrating the course inside. Never throws. */
export function parseCourseFile(raw: unknown, options: ParseOptions = {}): ParseCourseFileResult {
  try {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, issues: [{ path: '', message: 'This is not a Care Hub course file.' }] };
    }
    const envelope = raw as Record<string, unknown>;
    if (envelope.format !== COURSE_FILE_FORMAT) {
      return {
        ok: false,
        issues: [
          {
            path: 'format',
            message: `This is not a Care Hub course file (format should be "${COURSE_FILE_FORMAT}").`,
          },
        ],
      };
    }
    const migrated = runMigrations(
      envelope.course,
      COURSE_FORMAT_VERSION,
      options.migrations ?? COURSE_MIGRATIONS,
      'course',
    );
    if (!migrated.ok)
      return {
        ok: false,
        issues: migrated.issues.map((issue) => ({
          ...issue,
          path: issue.path ? `course.${issue.path}` : 'course',
        })),
      };
    const parsed = parseWith(CourseFileSchema, { ...envelope, course: migrated.value });
    if (!parsed.ok) return parsed;
    return migrated.migratedFrom === undefined
      ? { ok: true, file: parsed.value }
      : { ok: true, file: parsed.value, migratedFrom: migrated.migratedFrom };
  } catch {
    return failed();
  }
}

/** Wraps a course for export. `exportedAt` may be a Date or an ISO date and time. */
export function toCourseFile(course: Course, exportedAt?: Date | string): CourseFile {
  if (exportedAt === undefined) return { format: COURSE_FILE_FORMAT, course };
  return {
    format: COURSE_FILE_FORMAT,
    exportedAt: typeof exportedAt === 'string' ? exportedAt : exportedAt.toISOString(),
    course,
  };
}

/** Reads an untrusted learning path, like `parseCourse`. Never throws. */
export function parseLearningPath(
  raw: unknown,
  options: ParseOptions = {},
): ParseLearningPathResult {
  try {
    const migrated = runMigrations(
      raw,
      LEARNING_PATH_FORMAT_VERSION,
      options.migrations ?? LEARNING_PATH_MIGRATIONS,
      'learning path',
    );
    if (!migrated.ok) return migrated;
    const parsed = parseWith(LearningPathSchema, migrated.value);
    if (!parsed.ok) return parsed;
    return migrated.migratedFrom === undefined
      ? { ok: true, learningPath: parsed.value }
      : { ok: true, learningPath: parsed.value, migratedFrom: migrated.migratedFrom };
  } catch {
    return failed();
  }
}
