import { describe, expect, it } from 'vitest';
import { createCourse, richText, type Block, type Course } from '../format/index';
import { embedIssues } from './embed-issues';

const course = (...blocks: Block[]): Course => ({
  ...createCourse({ type: 'standard', title: 'Ward basics', id: 'ward_basics' }),
  lessons: [
    {
      id: 'intro',
      kind: 'content',
      title: 'Welcome',
      blocks: [{ id: 'p1', type: 'paragraph', text: richText('Hello.') }],
    },
    { id: 'tour', kind: 'content', title: 'Ward tour', blocks },
  ],
});

describe('embedIssues', () => {
  it('passes allowed embeds, video sites and uploads', () => {
    const ok = course(
      {
        id: 'e1',
        type: 'embed',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Tour',
      },
      {
        id: 'v1',
        type: 'video',
        media: { kind: 'url', url: 'https://vimeo.com/123456789' },
        title: 'Tour',
      },
      { id: 'v2', type: 'video', media: { kind: 'file', fileId: 'file_tour' }, title: 'Tour' },
      {
        id: 'a1',
        type: 'audio',
        media: { kind: 'file', fileId: 'file_handover' },
        title: 'Handover',
      },
    );
    expect(embedIssues(ok)).toEqual([]);
  });

  it("lists embeds and media links the player won't show, like checkPublishable does", () => {
    const bad = course(
      { id: 'e1', type: 'embed', url: 'https://example.com/rota', title: 'Rota' },
      {
        id: 'v1',
        type: 'video',
        media: { kind: 'url', url: 'https://www.youtube.com/@carehub' },
        title: 'Tour',
      },
      {
        id: 'v2',
        type: 'video',
        media: { kind: 'url', url: 'https://media.example.org/tour.mp4' },
        title: 'Tour',
      },
      {
        id: 'a1',
        type: 'audio',
        media: { kind: 'url', url: 'https://media.example.org/handover.mp3' },
        title: 'Talk',
      },
    );
    const problems = embedIssues(bad);
    expect(problems.map(({ path, lessonId, blockId }) => ({ path, lessonId, blockId }))).toEqual([
      { path: 'lessons[1].blocks[0].url', lessonId: 'tour', blockId: 'e1' },
      { path: 'lessons[1].blocks[1].media.url', lessonId: 'tour', blockId: 'v1' },
      { path: 'lessons[1].blocks[2].media.url', lessonId: 'tour', blockId: 'v2' },
      { path: 'lessons[1].blocks[3].media.url', lessonId: 'tour', blockId: 'a1' },
    ]);
    expect(problems[0]?.message).toMatch(
      /^Lesson 2 "Ward tour": block 1 \(embed\) can't be shown\. Pages from example\.com can't be embedded\./,
    );
    expect(problems[1]?.message).toBe(
      `Lesson 2 "Ward tour": block 2 (video) can't be played. This YouTube link isn't a video. Open the video and copy its address, or use Share.`,
    );
    expect(problems[2]?.message).toBe(
      `Lesson 2 "Ward tour": block 3 (video) can't be played. Care Hub can't play video files from other sites. Download the video, then upload it here.`,
    );
    expect(problems[3]?.message).toBe(
      `Lesson 2 "Ward tour": block 4 (audio) can't be played. Care Hub can't play audio from other sites. Download the file, then upload it here.`,
    );
  });
});
