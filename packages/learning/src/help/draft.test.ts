import { describe, expect, it } from 'vitest';
import { ContentLessonSchema, createCourse, richText } from '../format/index';
import {
  HelpCourseDraftAnswerSchema,
  HelpCourseDraftRequestSchema,
  type HelpDraftLesson,
} from './api';
import { helpCourseDraft } from './draft';
import { helpCourseDraftPrompt } from './prompts';

// Fictional course text only.
const course = createCourse({ type: 'standard', title: 'Billing calls' });

const counter = () => {
  let next = 0;
  return () => `new-${++next}`;
};

const lesson: HelpDraftLesson = {
  title: 'Opening the call',
  blocks: [
    { type: 'heading', text: 'Greeting' },
    { type: 'paragraph', text: 'Say your name.\n\nAsk how you can help.' },
    { type: 'list', style: 'numbered', items: ['Greet', 'Listen'] },
    { type: 'callout', tone: 'tip', text: 'Smile [add the greeting your team uses].' },
  ],
};

describe('Learning help: course drafts', () => {
  it("takes the author's description up to 1,000 characters and 1 to 8 lessons, 4 by default", () => {
    const request = {
      courseId: 'course-1',
      revision: 1,
      description: 'A short course on billing calls.',
    };
    expect(HelpCourseDraftRequestSchema.parse(request).lessons).toBe(4);
    for (const bad of [{ description: ' ' }, { description: 'x'.repeat(1001) }, { lessons: 9 }]) {
      expect(HelpCourseDraftRequestSchema.safeParse({ ...request, ...bad }).success).toBe(false);
    }
    expect(helpCourseDraftPrompt(1).instruction).toContain('in the selection, with 1 lesson of');
  });

  it('turns draft lessons into content lessons with fresh ids that pass the format', () => {
    const [made, ...rest] = helpCourseDraft(course, [lesson], counter());
    expect(rest).toEqual([]);
    expect(made).toEqual({
      id: 'new-1',
      kind: 'content',
      title: 'Opening the call',
      blocks: [
        { id: 'new-2', type: 'heading', level: 2, text: 'Greeting' },
        {
          id: 'new-3',
          type: 'paragraph',
          text: richText('Say your name.', 'Ask how you can help.'),
        },
        {
          id: 'new-4',
          type: 'list',
          style: 'numbered',
          items: [
            { id: 'new-5', text: richText('Greet') },
            { id: 'new-6', text: richText('Listen') },
          ],
        },
        {
          id: 'new-7',
          type: 'callout',
          tone: 'tip',
          text: richText('Smile [add the greeting your team uses].'),
        },
      ],
    });
    expect(ContentLessonSchema.safeParse(made).success).toBe(true);
  });

  it('leaves out blocks and lessons that fail the checks', () => {
    // Claude's answer passes HelpCourseDraftAnswerSchema first; these skip it to reach the course checks.
    const blankParagraph: HelpDraftLesson = {
      title: 'Wrap-up',
      blocks: [
        { type: 'heading', text: 'Done' },
        { type: 'paragraph', text: ' \n\n ' },
      ],
    };
    const onlyBlank: HelpDraftLesson = {
      title: 'Notes',
      blocks: [{ type: 'paragraph', text: ' ' }],
    };
    const untitled: HelpDraftLesson = { ...lesson, title: '' };
    const made = helpCourseDraft(course, [blankParagraph, onlyBlank, untitled]);
    expect(made).toHaveLength(1);
    expect(made[0]?.blocks).toMatchObject([{ type: 'heading', text: 'Done' }]);
    expect(
      HelpCourseDraftAnswerSchema.safeParse({ summary: 'S', lessons: [blankParagraph] }).success,
    ).toBe(false);
  });
});
