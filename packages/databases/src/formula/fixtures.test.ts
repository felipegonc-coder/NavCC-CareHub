import { describe, expect, it } from 'vitest';
import { FORMULA_FIXTURES, runFixture } from './fixtures';

describe('formula fixtures', () => {
  it('has at least 120 core examples', () => {
    expect(FORMULA_FIXTURES.length >= 120).toBe(true);
  });

  it('gives the expected value or message for every example', () => {
    const wrong = FORMULA_FIXTURES.flatMap((f) => {
      const got = runFixture(f);
      const want = f.error !== undefined ? { error: f.error } : { value: f.value ?? null };
      return JSON.stringify(got) === JSON.stringify(want)
        ? []
        : [{ formula: f.formula, want, got }];
    });
    expect(wrong).toEqual([]);
  });
});
