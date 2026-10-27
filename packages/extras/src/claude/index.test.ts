import { describe, expect, it } from 'vitest';
import {
  CLAUDE_ERROR_REASONS,
  CLAUDE_ERRORS,
  CLAUDE_FEATURE_LABELS,
  CLAUDE_FEATURE_SENDS,
  CLAUDE_FEATURES,
  CLAUDE_NAV_OK_LABEL,
  CLAUDE_NAV_OK_NOTE,
  claudeSwitchKey,
  isClaudeFeature,
} from './index';

describe('Claude names', () => {
  it('gives every feature a label, what it sends and its own switch key', () => {
    const keys = CLAUDE_FEATURES.map((feature) => claudeSwitchKey(feature));
    expect(new Set(keys).size).toBe(CLAUDE_FEATURES.length);
    expect(claudeSwitchKey('learning_help')).toBe('claude.learning_help');
    for (const feature of CLAUDE_FEATURES) {
      expect(CLAUDE_FEATURE_LABELS[feature]).toBeTruthy();
      expect(CLAUDE_FEATURE_SENDS[feature]).toContain("to Anthropic's Claude");
    }
  });

  it('uses the switch names and confirm words of the Claude features spec', () => {
    expect([
      CLAUDE_FEATURE_LABELS.writing_help,
      CLAUDE_FEATURE_LABELS.assistant,
      CLAUDE_FEATURE_LABELS.fields,
      CLAUDE_FEATURE_LABELS.meeting_summary,
    ]).toEqual(['Writing help', 'Assistant', 'Claude fields', 'Meeting summary']);
    expect(`${CLAUDE_FEATURE_SENDS.writing_help} ${CLAUDE_NAV_OK_NOTE}`).toBe(
      "Writing help sends the text people select, and the text around it, to Anthropic's Claude. Only turn this on with Nav's written OK.",
    );
    expect(CLAUDE_NAV_OK_LABEL).toBe('Nav has given the OK');
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

  it("uses the spec's words for the limits and for Claude being unavailable", () => {
    expect(CLAUDE_ERRORS.monthly_cap.message).toBe(
      "Claude has reached this month's limit. An Admin can raise it in Settings → Claude.",
    );
    expect(CLAUDE_ERRORS.user_rate_limit.message).toBe(
      "You've asked a lot this hour. Try again in a few minutes.",
    );
    expect(CLAUDE_ERRORS.unavailable.message).toBe("Claude isn't available right now.");
  });
});
