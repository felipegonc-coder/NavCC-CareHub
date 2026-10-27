import type { Block, Course, CourseType, Id, PublishProblem } from '@carehub/learning';

// The Studio talks to drafts through this interface (api.md, "Studio course API"). The local implementation
// keeps drafts in the browser until the server version lands; both behave the same way, including the
// revision check on save and the publish problems.

/** Where a course stands: never published, published as it is, or published with unpublished changes. */
export type StudioCourseState = 'draft' | 'live' | 'changed';

/** One course in the Studio list. */
export type StudioCourseSummary = {
  id: Id;
  title: string;
  type: CourseType;
  state: StudioCourseState;
  /** The live version number, or null before the first publish. */
  version: number | null;
  /** ISO date-time of the last saved change. */
  updatedAt: string;
  archived: boolean;
  listed: boolean;
};

/** A draft with the revision to send back when saving it. */
export type StudioDraft = { course: Course; revision: number; liveVersion: number | null };

/**
 * What a new version means for people who already started (0311): nobody moves (`none`), runs in progress move
 * and those people are told (`tell`), or everyone who started begins again (`retake`).
 */
export type PublishNotify = 'none' | 'tell' | 'retake';

/** A published version, newest first in lists. */
export type StudioCourseVersion = {
  version: number;
  publishedAt: string;
  title: string;
  note?: string;
};

/** An example course to start from. */
export type StudioExample = { id: Id; title: string; type: CourseType; summary: string };

/** Saved blocks to insert again. */
export type BlockTemplate = { id: Id; name: string; blocks: Block[] };

/**
 * Why a Studio call failed, following the API's error codes: `invalid` (400), `forbidden` (403), `not_found`
 * (404), `conflict` (409, someone saved a newer revision), `publish_problems` (422), `offline` (no answer from
 * the server) and `failed` (anything else).
 */
export type StudioErrorCode =
  'invalid' | 'forbidden' | 'not_found' | 'conflict' | 'publish_problems' | 'offline' | 'failed';

/** A failed Studio call. `problems` lists what to fix when publishing was refused. */
export class StudioError extends Error {
  readonly code: StudioErrorCode;
  readonly problems: PublishProblem[];

  constructor(code: StudioErrorCode, message: string, problems: PublishProblem[] = []) {
    super(message);
    this.name = 'StudioError';
    this.code = code;
    this.problems = problems;
  }
}

/** True when `error` is a StudioError with `code`. */
export function isStudioError(error: unknown, code?: StudioErrorCode): error is StudioError {
  return error instanceof StudioError && (code === undefined || error.code === code);
}

/** Everything the Studio screens need from storage. Every call is async, like the server. */
export interface StudioClient {
  listCourses(options?: { archived?: boolean }): Promise<StudioCourseSummary[]>;
  /** A new draft of `type`, or a copy of an example course. */
  createCourse(input: { type: CourseType; title?: string; exampleId?: Id }): Promise<StudioDraft>;
  getCourse(courseId: Id): Promise<StudioDraft>;
  /** Saves the draft. Fails with `conflict` when someone saved a newer revision first. */
  saveCourse(courseId: Id, course: Course, revision: number): Promise<{ revision: number }>;
  /** Publishes the saved draft as a new version. Fails with `publish_problems` when it isn't ready. */
  publish(
    courseId: Id,
    input: { notify: PublishNotify; note?: string },
  ): Promise<{ version: number }>;
  listVersions(courseId: Id): Promise<StudioCourseVersion[]>;
  /** Publishes a copy of an earlier version (the draft becomes that version too). */
  rollback(courseId: Id, version: number): Promise<{ version: number }>;
  duplicate(courseId: Id): Promise<StudioCourseSummary>;
  archive(courseId: Id): Promise<StudioCourseSummary>;
  unarchive(courseId: Id): Promise<StudioCourseSummary>;
  listExamples(): Promise<StudioExample[]>;
  listBlockTemplates(): Promise<BlockTemplate[]>;
  saveBlockTemplate(input: { name: string; blocks: Block[] }): Promise<BlockTemplate>;
  deleteBlockTemplate(templateId: Id): Promise<void>;
}
