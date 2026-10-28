import { describe, expect, it } from 'vitest';
import { CLAUDE_CONFIRM_LABEL } from './index';
import {
  claudeSettingsUpdateSchema,
  CONFIRM_REQUIRED,
  MAX_MONTHLY_REQUESTS,
  monthlyLimitSchema,
  turnsSwitchOn,
} from './settings';

describe('Settings → Claude shapes', () => {
  it('turns a switch on only when its confirm was ticked, and off without it', () => {
    const on = claudeSettingsUpdateSchema.safeParse({ switches: { writing_help: true } });
    expect(on.success).toBe(false);
    expect(on.error?.issues).toMatchObject([{ path: ['confirmed'], message: CONFIRM_REQUIRED }]);
    expect(CONFIRM_REQUIRED).toBe(`Tick "${CLAUDE_CONFIRM_LABEL}" to turn a feature on.`);

    const ticked = { switches: { writing_help: true }, confirmed: true };
    expect(claudeSettingsUpdateSchema.parse(ticked)).toEqual(ticked);
    const off = { switches: { writing_help: false, assistant: false } };
    expect(claudeSettingsUpdateSchema.parse(off)).toEqual(off);
    expect(claudeSettingsUpdateSchema.safeParse({ ...ticked, confirmed: false }).success).toBe(
      false,
    );
  });

  it('refuses anything it does not know', () => {
    for (const update of [
      { switches: { telepathy: true } },
      { monthlyRequests: 3000, theme: 'dark' },
    ]) {
      expect(claudeSettingsUpdateSchema.safeParse(update).success).toBe(false);
    }
  });

  it('takes a monthly limit from 0 to 1,000,000 in whole requests', () => {
    for (const limit of [0, 3000, MAX_MONTHLY_REQUESTS]) {
      expect(monthlyLimitSchema.safeParse(limit).success).toBe(true);
      expect(claudeSettingsUpdateSchema.parse({ monthlyRequests: limit })).toEqual({
        monthlyRequests: limit,
      });
    }
    for (const limit of [-1, 2.5, MAX_MONTHLY_REQUESTS + 1, '3000']) {
      expect(monthlyLimitSchema.safeParse(limit).success).toBe(false);
    }
  });

  it('knows when an update turns a switch on', () => {
    expect(turnsSwitchOn({})).toBe(false);
    expect(turnsSwitchOn({ switches: { assistant: false } })).toBe(false);
    expect(turnsSwitchOn({ switches: { assistant: false, fields: true } })).toBe(true);
  });
});
