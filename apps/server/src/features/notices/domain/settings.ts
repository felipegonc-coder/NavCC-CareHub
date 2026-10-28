// Which kinds of notices reach a person's 🔔 Care Hub chat (Settings → Notifications, spec 3.3).
import type { NoticeKind, NoticeSettingKey, NoticeSettings } from '../types';

/** In Settings order. */
export const NOTICE_SETTING_KEYS = [
  'comments',
  'edits',
  'formResponses',
  'automations',
] as const satisfies readonly NoticeSettingKey[];

/** Until the person changes something: every kind on. */
export const DEFAULT_NOTICE_SETTINGS: Readonly<NoticeSettings> = Object.freeze({
  comments: true,
  edits: true,
  formResponses: true,
  automations: true,
});

/** Just the switches in a change: keys it leaves out, and anything else it carries, are dropped. */
export function pickNoticeSettings(change: Partial<NoticeSettings>): Partial<NoticeSettings> {
  const picked: Partial<NoticeSettings> = {};
  for (const key of NOTICE_SETTING_KEYS) {
    const value = change[key];
    if (value !== undefined) picked[key] = value;
  }
  return picked;
}

/**
 * The setting that can turn each kind off. The rest are always on: mentions, replies, reminders
 * and access requests (spec 3.3), and alerts, shares, imports, exports, reviews and what happened
 * to the person's own suggestions. `formResponses` gets its kind, `form_response`, with Forms.
 */
const SETTING_FOR_KIND: Readonly<Partial<Record<NoticeKind, NoticeSettingKey>>> = {
  comment: 'comments',
  suggestion: 'comments',
  edit_summary: 'edits',
  automation: 'automations',
};

/** The setting that turns this kind off, or null when it's always on. */
export function noticeSettingFor(kind: NoticeKind): NoticeSettingKey | null {
  return SETTING_FOR_KIND[kind] ?? null;
}

/** Whether notices of this kind reach the person with these settings. */
export function isNoticeOn(settings: NoticeSettings, kind: NoticeKind): boolean {
  const key = noticeSettingFor(kind);
  return key === null || settings[key];
}
