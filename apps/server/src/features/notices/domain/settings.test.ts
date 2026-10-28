import { describe, expect, it } from 'vitest';
import { NOTICE_KINDS, type NoticeKind } from '../types';
import {
  DEFAULT_NOTICE_SETTINGS,
  isNoticeOn,
  noticeSettingFor,
  pickNoticeSettings,
} from './settings';

describe('notice settings', () => {
  it('lets the person turn off what spec 3.3 lists, and nothing else', () => {
    const switchable = Object.fromEntries(
      NOTICE_KINDS.flatMap((kind) => {
        const key = noticeSettingFor(kind);
        return key === null ? [] : [[kind, key]];
      }),
    );
    expect(switchable).toEqual({
      comment: 'comments',
      suggestion: 'comments',
      edit_summary: 'edits',
      automation: 'automations',
    });
  });

  it('keeps mentions, replies, reminders and access requests on', () => {
    const allOff = { comments: false, edits: false, formResponses: false, automations: false };
    const alwaysOn: NoticeKind[] = ['mention', 'reply', 'reminder', 'access_request', 'alert'];
    for (const kind of alwaysOn) expect(isNoticeOn(allOff, kind)).toBe(true);
    expect(isNoticeOn(allOff, 'comment')).toBe(false);
  });

  it('turns off one kind at a time', () => {
    const settings = { ...DEFAULT_NOTICE_SETTINGS, edits: false };
    expect(isNoticeOn(settings, 'edit_summary')).toBe(false);
    expect(isNoticeOn(settings, 'comment')).toBe(true);
    expect(isNoticeOn(settings, 'automation')).toBe(true);
    expect(NOTICE_KINDS.every((kind) => isNoticeOn(DEFAULT_NOTICE_SETTINGS, kind))).toBe(true);
  });

  it('takes only the switches from a change', () => {
    const change = { edits: false, automations: undefined, workspaceId: 'other' };
    expect(pickNoticeSettings(change)).toEqual({ edits: false });
    expect(pickNoticeSettings({ ...DEFAULT_NOTICE_SETTINGS })).toEqual(DEFAULT_NOTICE_SETTINGS);
  });
});
