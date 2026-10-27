import type { PublishNotify } from '@carehub/learning';
import type { Db, Tx } from '../db';

/** A new live version, just saved (same transaction). `note` is the author's message to learners. */
export type CoursePublished = {
  workspaceId: string;
  courseId: string;
  version: number;
  notify: PublishNotify;
  note?: string;
};

/**
 * Publish hook (B3 fills it in): what changes for learners when a course gets a new live version, such as
 * "course changed" notices or asking people to take it again. The stub does nothing.
 */
export const onCoursePublished: (
  db: Db | Tx,
  published: CoursePublished,
) => Promise<void> = async () => {};
