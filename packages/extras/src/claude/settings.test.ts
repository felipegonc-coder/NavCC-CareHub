import { describe, expect, it } from 'vitest';
import {
  claudeSettingsUpdateSchema,
  MAX_MONTHLY_REQUESTS,
  monthlyLimitSchema,
  NAV_OK_REQUIRED,
  turnsSwitchOn,
} from './settings';

describe('Settings → Claude shapes', () => {
  it('turns a switch on only with navOk, and off without it', () => {
    const on = claudeSettingsUpdateSchema.safeParse({ switches: { writing_help: true } });
    expect(on.success).toBe(false);
    expect(on.error?.issues).toMatchObject([{ path: ['navOk'], message: NAV_OK_REQUIRED }]);
    expect(NAV_OK_REQUIRED).toBe('Tick "Nav has given the OK" to turn a feature on.');

    const confirmed = { switches: { writing_help: true }, navOk: true };
    expect(claudeSettingsUpdateSchema.parse(confirmed)).toEqual(confirmed);
    const off = { switches: { writing_help: false, assistant: false } };
    expect(claudeSettingsUpdateSchema.parse(off)).toEqual(off);
    expect(claudeSettingsUpdateSchema.safeParse({ ...confirmed, navOk: false }).success).toBe(
      false,
    );
  });

  it('refuses anything it does not know, including the old navApproved', () => {
    for (const update of [
      { navApproved: true },
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
