import { describe, expect, it } from 'vitest';
import {
  LIMIT_MESSAGES,
  MAX_ANSWERS,
  MAX_CHANGED,
  MAX_DELETED,
  checkAnswers,
  checkChanges,
} from './limits';

/** Distinct keys: only how many there are counts here. */
const keys = (count: number) => Array.from({ length: count }, (_, n) => `key-${String(n)}`);
const answers = (count: number) =>
  Object.fromEntries(keys(count).map((key) => [key, { reply: 'going' as const, note: null }]));

function failure(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('It should have failed.');
}

describe('limits on one event', () => {
  it('keeps up to 1,000 deleted and 500 changed occurrences on a series', () => {
    expect([MAX_DELETED, MAX_CHANGED]).toEqual([1000, 500]);
    const overrides = Object.fromEntries(keys(MAX_CHANGED).map((key) => [key, {}]));
    checkChanges({ exceptions: keys(MAX_DELETED), overrides });
    expect(failure(() => checkChanges({ exceptions: keys(1001), overrides: {} }))).toMatchObject({
      statusCode: 400,
      message: LIMIT_MESSAGES.deleted,
    });
    const more = { ...overrides, 'one more': {} };
    expect(failure(() => checkChanges({ exceptions: [], overrides: more }))).toMatchObject({
      statusCode: 400,
      message: LIMIT_MESSAGES.changed,
    });
  });

  it("keeps up to 1,000 of a person's answers for single occurrences", () => {
    expect(MAX_ANSWERS).toBe(1000);
    checkAnswers({ occurrenceReplies: answers(MAX_ANSWERS) });
    expect(failure(() => checkAnswers({ occurrenceReplies: answers(1001) }))).toMatchObject({
      statusCode: 400,
      message: LIMIT_MESSAGES.answers,
    });
  });
});
