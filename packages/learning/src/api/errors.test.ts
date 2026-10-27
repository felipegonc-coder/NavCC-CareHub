import { describe, expect, it } from 'vitest';
import { ApiErrorBodySchema, errorForStatus, PublishNotifySchema } from './index';

describe('API error shape', () => {
  it('gives each status its code and a plain message', () => {
    expect(errorForStatus(403)).toEqual({
      code: 'forbidden',
      message: "You don't have access to this.",
    });
    expect(errorForStatus(404)).toEqual({
      code: 'not_found',
      message: 'This was deleted, or the link is wrong.',
    });
    expect(
      [400, 401, 409, 413, 422, 429, 500].map((status) => errorForStatus(status).code),
    ).toEqual([
      'invalid',
      'signed_out',
      'conflict',
      'too_large',
      'cannot_publish',
      'rate_limited',
      'server_error',
    ]);
  });

  it('falls back to invalid for other 4xx and server_error for everything else', () => {
    expect(errorForStatus(405).code).toBe('invalid');
    expect(errorForStatus(418).code).toBe('invalid');
    expect(errorForStatus(503).code).toBe('server_error');
    expect(errorForStatus(0).code).toBe('server_error');
  });

  it('hands out copies, so callers can change them safely', () => {
    const first = errorForStatus(400);
    first.message = 'changed';
    expect(errorForStatus(400).message).not.toBe('changed');
  });

  it('reads error bodies, with or without issues', () => {
    const body = {
      error: {
        code: 'invalid',
        message: 'Check it.',
        issues: [{ path: 'title', message: 'Add a title.' }],
      },
    };
    expect(ApiErrorBodySchema.parse(body)).toEqual(body);
    expect(ApiErrorBodySchema.safeParse({ error: { code: 'x', message: 'y' } }).success).toBe(true);
    expect(ApiErrorBodySchema.safeParse({ error: { code: '', message: 'y' } }).success).toBe(false);
    expect(ApiErrorBodySchema.safeParse({ message: 'Not Found' }).success).toBe(false);
  });

  it('knows the publish notify options', () => {
    expect(PublishNotifySchema.options).toEqual(['none', 'tell', 'retake']);
    expect(PublishNotifySchema.safeParse('everyone').success).toBe(false);
  });
});
