import { describe, expect, it } from 'vitest';
import { parseWith, sampleStandardCourse } from '../index';
import {
  CreateReviewCommentRequestSchema,
  CreateReviewLinkRequestSchema,
  NewReviewLinkSchema,
  REVIEW_TOKEN_HEADER,
  ReviewReplySchema,
  UpdateReviewCommentRequestSchema,
} from './api';

describe('review API schemas', () => {
  it('makes links for 7, 30 or 90 days, 30 when not said', () => {
    expect(parseWith(CreateReviewLinkRequestSchema, {})).toEqual({ ok: true, value: { days: 30 } });
    expect(parseWith(CreateReviewLinkRequestSchema, { days: 90 })).toEqual({
      ok: true,
      value: { days: 90 },
    });
    expect(parseWith(CreateReviewLinkRequestSchema, { days: 14 })).toEqual({
      ok: false,
      issues: [{ path: 'days', message: 'Choose 7, 30 or 90 days.' }],
    });
  });

  it('reads a comment on a lesson, a block or a question, trimmed', () => {
    expect(
      parseWith(CreateReviewCommentRequestSchema, { lessonId: 'calls-before', body: '  Clear.  ' }),
    ).toEqual({ ok: true, value: { lessonId: 'calls-before', body: 'Clear.' } });
    expect(
      parseWith(CreateReviewCommentRequestSchema, {
        lessonId: 'calls-quiz',
        questionId: 'calls-q-first',
        body: 'Two answers look right.',
      }).ok,
    ).toBe(true);
  });

  it('refuses an empty or overlong comment, and one on a block and a question at once', () => {
    expect(
      parseWith(CreateReviewCommentRequestSchema, { lessonId: 'calls-before', body: '   ' }),
    ).toEqual({ ok: false, issues: [{ path: 'body', message: 'Write a comment first.' }] });
    expect(
      parseWith(CreateReviewCommentRequestSchema, {
        lessonId: 'calls-before',
        body: 'x'.repeat(2001),
      }),
    ).toEqual({
      ok: false,
      issues: [{ path: 'body', message: 'Keep it under 2000 characters.' }],
    });
    expect(
      parseWith(CreateReviewCommentRequestSchema, {
        lessonId: 'calls-quiz',
        blockId: 'calls-before-text',
        questionId: 'calls-q-first',
        body: 'Here.',
      }),
    ).toEqual({
      ok: false,
      issues: [{ path: 'questionId', message: 'Comment on a block or a question, not both.' }],
    });
    expect(
      parseWith(CreateReviewCommentRequestSchema, { lessonId: '../x', body: 'Here.' }).ok,
    ).toBe(false);
  });

  it('describes the replies: a new link with its url, the review with the draft', () => {
    const createdBy = { id: 'person-1', name: 'Tara Trainer' };
    const link = {
      id: 'link-1',
      createdAt: '2026-10-27T10:00:00.000Z',
      expiresAt: '2026-11-26T10:00:00.000Z',
      createdBy,
      url: '/learning/review#abc',
    };
    expect(parseWith(NewReviewLinkSchema, link)).toEqual({ ok: true, value: link });
    const review = {
      course: sampleStandardCourse,
      comments: [
        {
          id: 'comment-1',
          lessonId: 'calls-before',
          blockId: 'calls-before-text',
          body: 'Clear.',
          author: createdBy,
          createdAt: '2026-10-27T11:00:00.000Z',
          resolved: false,
        },
      ],
      expiresAt: link.expiresAt,
    };
    expect(parseWith(ReviewReplySchema, review).ok).toBe(true);
    expect(parseWith(UpdateReviewCommentRequestSchema, { resolved: 'yes' }).ok).toBe(false);
    expect(REVIEW_TOKEN_HEADER).toBe('X-Review-Token');
  });
});
