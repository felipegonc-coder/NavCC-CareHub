import { describe, expect, it } from 'vitest';
import {
  CLAUDE_ERROR_REASONS,
  CLAUDE_ERRORS,
  CLAUDE_FEATURE_LABELS,
  CLAUDE_FEATURES,
  claudeSwitchKey,
  isClaudeFeature,
} from './index';

describe('Claude names', () => {
  it('gives every feature a label and its own switch key', () => {
    const keys = CLAUDE_FEATURES.map((feature) => claudeSwitchKey(feature));
    expect(new Set(keys).size).toBe(CLAUDE_FEATURES.length);
    expect(claudeSwitchKey('learning_help')).toBe('claude.learning_help');
    for (const feature of CLAUDE_FEATURES) expect(CLAUDE_FEATURE_LABELS[feature]).toBeTruthy();
  });

  it('recognises feature names', () => {
    expect(isClaudeFeature('assistant')).toBe(true);
    expect(isClaudeFeature('everything')).toBe(false);
  });

  it('answers every error with a 4xx status and plain words', () => {
    for (const reason of CLAUDE_ERROR_REASONS) {
      const { status, message } = CLAUDE_ERRORS[reason];
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
      expect(message).toMatch(/\.$/);
    }
    expect(CLAUDE_ERRORS.no_permission.message).toBe("You don't have access to this.");
  });
});
