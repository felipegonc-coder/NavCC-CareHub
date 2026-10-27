import type { ButtonTarget, Id, Link } from '../format/index';
import { ID_PATTERN, LinkUrlSchema } from '../format/index';
import type { PlayerCourse } from './course';

/**
 * Where a rich-text link or a button goes. `external` is an https: or mailto: address (https opens in a new tab),
 * `page` a Care Hub page (`/p/<pageId>`), `file` a file in Care Hub's file storage (`/api/files/<fileId>`, opened in
 * a new tab so the lesson stays open), `lesson` a lesson (and block) in this course. `broken` says in plain words
 * why the link can't be followed.
 */
export type LinkTarget =
  | { kind: 'external'; href: string; newTab: boolean }
  | { kind: 'page'; href: string; pageId: string }
  | { kind: 'file'; href: string; fileId: string; newTab: true }
  | { kind: 'lesson'; href: string; lessonId: Id; blockId?: Id; lessonTitle: string }
  | { kind: 'broken'; reason: string };

const BLOCK_ANCHOR_PREFIX = 'block-';

/** The start page of a course: "/learning/courses/<courseId>". */
export function courseHref(courseId: Id): string {
  return `/learning/courses/${encodeURIComponent(courseId)}`;
}

/** A lesson in the player, optionally scrolled to one of its blocks ("…/lessons/<lessonId>#block-<blockId>"). */
export function lessonHref(courseId: Id, lessonId: Id, blockId?: Id): string {
  const path = `${courseHref(courseId)}/lessons/${encodeURIComponent(lessonId)}`;
  return blockId === undefined ? path : `${path}#${blockAnchorId(blockId)}`;
}

/** The DOM id (and URL fragment) of a block in the player, e.g. "block-b-intro". Block ids are safe in both. */
export function blockAnchorId(blockId: Id): string {
  return BLOCK_ANCHOR_PREFIX + blockId;
}

/** The block id in a URL fragment such as "#block-b-intro", or null when the fragment isn't a block anchor. */
export function blockIdFromHash(hash: string): Id | null {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!fragment.startsWith(BLOCK_ANCHOR_PREFIX)) return null;
  let id: string;
  try {
    id = decodeURIComponent(fragment.slice(BLOCK_ANCHOR_PREFIX.length));
  } catch {
    return null;
  }
  return ID_PATTERN.test(id) ? id : null;
}

/**
 * Where a link or button target goes in this course. Addresses are checked again (https: or mailto: only), and a
 * lesson link whose block is gone still opens the lesson; a link to a lesson that is gone is `broken`.
 */
export function linkTarget(
  course: Pick<PlayerCourse, 'id' | 'lessons'>,
  link: Link | ButtonTarget,
): LinkTarget {
  switch (link.kind) {
    case 'url':
      if (!LinkUrlSchema.safeParse(link.url).success) {
        return {
          kind: 'broken',
          reason: "This link can't be opened because its address isn't valid.",
        };
      }
      return { kind: 'external', href: link.url, newTab: /^https:/i.test(link.url) };
    case 'page':
      return { kind: 'page', href: `/p/${encodeURIComponent(link.pageId)}`, pageId: link.pageId };
    case 'file':
      return {
        kind: 'file',
        href: `/api/files/${encodeURIComponent(link.fileId)}`,
        fileId: link.fileId,
        newTab: true,
      };
    case 'lesson': {
      const lesson = course.lessons.find((candidate) => candidate.id === link.lessonId);
      if (!lesson)
        return {
          kind: 'broken',
          reason: 'This link goes to a lesson that is no longer in this course.',
        };
      const { blockId } = link;
      const hasBlock =
        blockId !== undefined &&
        lesson.kind === 'content' &&
        lesson.blocks.some((block) => block.id === blockId);
      return {
        kind: 'lesson',
        href: lessonHref(course.id, lesson.id, hasBlock ? blockId : undefined),
        lessonId: lesson.id,
        ...(hasBlock ? { blockId } : {}),
        lessonTitle: lesson.title,
      };
    }
  }
}
