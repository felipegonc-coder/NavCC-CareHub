import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { httpError as coreError } from '../../core/errors';
import { errorReply, httpError, LearningError, parseInput } from './errors';

describe('Learning API errors', () => {
  it('sends our own errors with their code, message and issues', () => {
    const issues = [{ path: 'title', message: 'Add a title.' }];
    expect(errorReply(new LearningError(422, 'cannot_publish', 'Fix 1 problem.', issues))).toEqual({
      status: 422,
      body: { error: { code: 'cannot_publish', message: 'Fix 1 problem.', issues } },
    });
    expect(errorReply(httpError(404))).toEqual({
      status: 404,
      body: { error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' } },
    });
    expect(
      errorReply(httpError(409, 'Someone else saved first. Reload to see their changes.')),
    ).toEqual({
      status: 409,
      body: {
        error: {
          code: 'conflict',
          message: 'Someone else saved first. Reload to see their changes.',
        },
      },
    });
  });

  it('sends at most 100 issues, then says how many more there are', () => {
    const issues = Array.from({ length: 103 }, (_, index) => ({
      path: `lessons[${index}].title`,
      message: 'Add a title.',
    }));
    const { body } = errorReply(
      httpError(422, 'Fix these 103 problems before publishing.', issues),
    );
    expect(body.error.issues).toHaveLength(101);
    expect(body.error.issues?.slice(0, 100)).toEqual(issues.slice(0, 100));
    expect(body.error.issues?.[100]).toEqual({ path: '', message: 'And 3 more.' });
  });

  it("keeps core's code and message, as from the sign-in and security checks", () => {
    expect(errorReply(coreError(401, 'signed_out'))).toEqual({
      status: 401,
      body: { error: { code: 'signed_out', message: 'Sign in to continue.' } },
    });
    const blocked = 'This request came from another site, so it was blocked.';
    expect(errorReply(coreError(403, 'forbidden', blocked))).toEqual({
      status: 403,
      body: { error: { code: 'forbidden', message: blocked } },
    });
  });

  it("keeps a framework error's status but never its wording", () => {
    const tooLarge = Object.assign(
      new Error('Request body is too large (FST_ERR_CTP_BODY_TOO_LARGE)'),
      {
        statusCode: 413,
      },
    );
    expect(errorReply(tooLarge)).toEqual({
      status: 413,
      body: { error: { code: 'too_large', message: "That's over the size limit." } },
    });
  });

  it('turns anything else into a 500 that says nothing about the cause', () => {
    for (const thrown of [
      new Error('connection refused at 10.0.0.5'),
      'oops',
      null,
      { statusCode: 200 },
    ]) {
      expect(errorReply(thrown)).toEqual({
        status: 500,
        body: {
          error: {
            code: 'server_error',
            message: 'Something went wrong on our side. Try again in a moment.',
          },
        },
      });
    }
  });

  it('reads input with a schema, or throws a 400 with readable issues', () => {
    const schema = z.object({ title: z.string().min(1).max(5) });
    expect(parseInput(schema, { title: 'Hi' })).toEqual({ title: 'Hi' });
    let thrown: unknown;
    try {
      parseInput(schema, { title: 'Far too long' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LearningError);
    const { status, body } = errorReply(thrown);
    expect(status).toBe(400);
    expect(body.error.code).toBe('invalid');
    expect(body.error.issues?.map((issue) => issue.path)).toEqual(['title']);
  });
});
