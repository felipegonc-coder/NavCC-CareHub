import { describe, expect, it } from 'vitest';
import { APP_NAME, healthResponseSchema } from './index';

describe('@carehub/shared', () => {
  it('names the app', () => {
    expect(APP_NAME).toBe('Care Hub');
  });

  it('accepts a healthy response', () => {
    expect(healthResponseSchema.parse({ status: 'ok', version: '1.0.0' })).toEqual({
      status: 'ok',
      version: '1.0.0',
    });
  });

  it('rejects anything else', () => {
    expect(healthResponseSchema.safeParse({ status: 'down', version: '1.0.0' }).success).toBe(
      false,
    );
    expect(healthResponseSchema.safeParse({ status: 'ok', version: '' }).success).toBe(false);
    expect(healthResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
  });
});
