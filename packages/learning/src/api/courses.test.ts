import { describe, expect, it } from 'vitest';
import {
  createCourse,
  learnerCourse,
  parseWith,
  sampleCourses,
  sampleStandardCourse,
} from '../index';
import {
  ApiIssueSchema,
  BLOCK_TEMPLATE_LIMITS,
  BlockTemplateSchema,
  CatalogEntrySchema,
  CatalogQuerySchema,
  CourseSummarySchema,
  CreateBlockTemplateRequestSchema,
  CreateCourseRequestSchema,
  LearnerCourseReplySchema,
  LiveCourseSchema,
  PublishRequestSchema,
  RollbackRequestSchema,
  SaveDraftRequestSchema,
  StudioCourseSchema,
} from './index';

describe('course API schemas', () => {
  it('reads a create request with or without a title, and refuses an unknown type', () => {
    expect(parseWith(CreateCourseRequestSchema, { type: 'standard' })).toEqual({
      ok: true,
      value: { type: 'standard' },
    });
    expect(
      parseWith(CreateCourseRequestSchema, { type: 'certification', title: 'Escalations' }),
    ).toMatchObject({ ok: true, value: { title: 'Escalations' } });
    expect(
      parseWith(CreateCourseRequestSchema, {
        type: 'standard',
        exampleId: 'course-calls-with-care',
      }).ok,
    ).toBe(true);
    expect(
      parseWith(CreateCourseRequestSchema, { type: 'standard', exampleId: 'no spaces' }).ok,
    ).toBe(false);
    const refused = parseWith(CreateCourseRequestSchema, { type: 'webinar' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.issues.map((issue) => issue.path)).toEqual(['type']);
  });

  it('needs a revision from 1 up to save a draft, and leaves checking the course to the server', () => {
    expect(parseWith(SaveDraftRequestSchema, { course: { anything: true }, revision: 3 }).ok).toBe(
      true,
    );
    for (const revision of [0, 1.5, '2', undefined])
      expect(parseWith(SaveDraftRequestSchema, { course: {}, revision }).ok).toBe(false);
  });

  it('trims the publish note and allows only none, tell and retake', () => {
    expect(parseWith(PublishRequestSchema, { notify: 'tell', note: '  New intro  ' })).toEqual({
      ok: true,
      value: { notify: 'tell', note: 'New intro' },
    });
    expect(parseWith(PublishRequestSchema, { notify: 'loudly' }).ok).toBe(false);
    expect(parseWith(PublishRequestSchema, { notify: 'none', note: 'x'.repeat(10_000) }).ok).toBe(
      false,
    );
  });

  it('rolls back without telling anyone unless asked', () => {
    expect(parseWith(RollbackRequestSchema, { version: 2 })).toEqual({
      ok: true,
      value: { version: 2, notify: 'none' },
    });
    expect(parseWith(RollbackRequestSchema, { version: 0 }).ok).toBe(false);
  });

  it('describes what Studio and learners get back', () => {
    const course = createCourse({ type: 'standard', title: 'Calls', id: 'course-calls' });
    expect(parseWith(StudioCourseSchema, { course, revision: 1, liveVersion: null }).ok).toBe(true);
    expect(parseWith(LiveCourseSchema, { course, version: 1 }).ok).toBe(true);
    expect(parseWith(LiveCourseSchema, { course, version: null }).ok).toBe(false);
    const withQuiz = sampleCourses.find((sample) => sample.lessons.some((l) => l.kind === 'quiz'));
    if (!withQuiz) throw new Error('A sample course has a quiz.');
    const learner = { course: learnerCourse(withQuiz), version: 3 };
    expect(parseWith(LearnerCourseReplySchema, learner).ok).toBe(true);
    expect(parseWith(LearnerCourseReplySchema, { course: withQuiz, version: 3 }).ok).toBe(false);
    const summary = {
      id: course.id,
      title: course.title,
      type: course.type,
      state: 'changed',
      version: 2,
      updatedAt: '2026-10-27T09:30:00.000Z',
      archived: false,
      listed: true,
    };
    expect(parseWith(CourseSummarySchema, summary).ok).toBe(true);
    expect(parseWith(CourseSummarySchema, { ...summary, state: 'hidden' }).ok).toBe(false);
  });

  it('lets a publish problem name its lesson, block and question', () => {
    const issue = {
      path: 'lessons[1].blocks[0].questions[2].options',
      message: 'Mark at least one right answer.',
      lessonId: 'lesson-1',
      blockId: 'block-1',
      questionId: 'question-3',
    };
    expect(parseWith(ApiIssueSchema, issue)).toEqual({ ok: true, value: issue });
  });

  it('reads catalog searches and describes catalog entries', () => {
    expect(parseWith(CatalogQuerySchema, { q: '  calls ', topic: 'Phones' })).toEqual({
      ok: true,
      value: { q: 'calls', topic: 'Phones' },
    });
    expect(parseWith(CatalogQuerySchema, {})).toEqual({ ok: true, value: {} });
    const { id, title, type, summary, cover, topics, estimatedMinutes, lessons } =
      sampleStandardCourse;
    const entry = { id, title, type, summary, cover, topics, estimatedMinutes };
    expect(
      parseWith(CatalogEntrySchema, { ...entry, lessonCount: lessons.length, version: 3 }).ok,
    ).toBe(true);
    expect(parseWith(CatalogEntrySchema, { ...entry, lessonCount: 1 }).ok).toBe(false);
  });

  it('keeps block templates to a name and 1 to 50 valid blocks', () => {
    const [lesson] = sampleStandardCourse.lessons;
    const blocks = lesson?.kind === 'content' ? lesson.blocks.slice(0, 1) : [];
    expect(blocks).toHaveLength(1);
    expect(parseWith(CreateBlockTemplateRequestSchema, { name: ' Greeting ', blocks })).toEqual({
      ok: true,
      value: { name: 'Greeting', blocks },
    });
    for (const input of [
      { name: ' ', blocks },
      { name: 'Greeting', blocks: [] },
      { name: 'Greeting', blocks: [{ type: 'not_a_block', id: 'b1' }] },
      { name: 'Greeting', blocks: Array(BLOCK_TEMPLATE_LIMITS.blocks + 1).fill(blocks[0]) },
    ])
      expect(parseWith(CreateBlockTemplateRequestSchema, input).ok).toBe(false);
    const template = {
      id: 'template-1',
      name: 'Greeting',
      blocks,
      createdAt: '2026-10-27T09:30:00Z',
    };
    expect(parseWith(BlockTemplateSchema, template).ok).toBe(true);
  });
});
