import { describe, expect, it } from 'vitest';
import { createCourse, parseWith } from '../index';
import {
  ApiIssueSchema,
  CourseSummarySchema,
  CreateCourseRequestSchema,
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
});
