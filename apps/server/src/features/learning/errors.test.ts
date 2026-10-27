import { describe, expect, it } from 'vitest';
import { z } from 'zod';
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

  it("keeps a framework error's status but never its wording", () => {
    const tooLarge = Object.assign(
      new Error('Request body is too large (FST_ERR_CTP_BODY_TOO_LARGE)'),
      {
        statusCode: 413,
      },
    );
    expect(errorReply(tooLarge)).toEqual({
      status: 413,
      body: { error: { code: 'too_large', message: 'This is larger than Care Hub allows.' } },
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
            message: 'Something went wrong on our side. Try again soon.',
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
