import type { Course, PublishProblem } from '../format/index';
import { mediaSource, toEmbed } from './embed';

/**
 * Publish problems for links the player won't show: embed blocks that aren't on the embed allow-list, and video
 * or audio links Care Hub won't play (only video sites play; media files from other sites must be uploaded).
 * Same shape and wording as `checkPublishable`, so the publish route and Studio can list both together.
 */
export function embedIssues(course: Course): PublishProblem[] {
  const problems: PublishProblem[] = [];
  course.lessons.forEach((lesson, lessonIndex) => {
    if (lesson.kind !== 'content') return;
    const title = lesson.title.trim();
    const lessonLabel = title
      ? `Lesson ${lessonIndex + 1} "${title}"`
      : `Lesson ${lessonIndex + 1}`;
    lesson.blocks.forEach((block, blockIndex) => {
      const label = `${lessonLabel}: block ${blockIndex + 1} (${block.type.replaceAll('_', ' ')})`;
      const add = (subPath: string, text: string) =>
        problems.push({
          path: `lessons[${lessonIndex}].blocks[${blockIndex}]${subPath}`,
          lessonId: lesson.id,
          blockId: block.id,
          message: `${label} ${text}`,
        });
      if (block.type === 'embed') {
        const embed = toEmbed(block.url);
        if (!embed.ok) add('.url', `can't be shown. ${embed.reason}`);
      } else if (block.type === 'video' || block.type === 'audio') {
        const source = mediaSource(block.media, block.type);
        if (source.kind === 'refused') add('.media.url', `can't be played. ${source.reason}`);
      }
    });
  });
  return problems;
}
