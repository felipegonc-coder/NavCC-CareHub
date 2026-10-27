// Push settings from the server's settings file. Missing or unusable settings switch push off
// with a plain message; they never stop the server, and messages never contain key material.
import { z } from 'zod';
import { importVapidKeys, VapidKeyError, type VapidKeys } from './protocol/vapid';

/**
 * For `readSettings(schema)` (apps/server/src/core/settings.ts). Plain optional strings, so a
 * malformed value can't stop the server: `resolvePushConfig` checks them instead.
 */
export const pushSettingsSchema = z.object({
  PUSH_VAPID_PUBLIC_KEY: z.string().optional(),
  PUSH_VAPID_PRIVATE_KEY: z.string().optional(),
  PUSH_VAPID_SUBJECT: z.string().optional(),
});

export type PushSettings = z.infer<typeof pushSettingsSchema>;

export type PushConfig =
  | { enabled: true; publicKey: string; vapid: { keys: VapidKeys; subject: string } }
  | { enabled: false; message: string };

export const PUSH_OFF_MESSAGE = "Notifications when Care Hub isn't open aren't set up yet.";

export function resolvePushConfig(settings: PushSettings): PushConfig {
  const publicKey = settings.PUSH_VAPID_PUBLIC_KEY?.trim() ?? '';
  const privateKey = settings.PUSH_VAPID_PRIVATE_KEY?.trim() ?? '';
  const subject = settings.PUSH_VAPID_SUBJECT?.trim() ?? '';
  const missing = Object.entries({
    PUSH_VAPID_PUBLIC_KEY: publicKey,
    PUSH_VAPID_PRIVATE_KEY: privateKey,
    PUSH_VAPID_SUBJECT: subject,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length === 3) return off(PUSH_OFF_MESSAGE);
  if (missing.length > 0) return off(`${PUSH_OFF_MESSAGE} Missing: ${missing.join(', ')}.`);
  if (!isContact(subject)) {
    return off('Push is off: PUSH_VAPID_SUBJECT must be a mailto: or https: address.');
  }
  let keys: VapidKeys;
  try {
    keys = importVapidKeys({ publicKey, privateKey });
  } catch (error) {
    const reason = error instanceof VapidKeyError ? error.message : 'The keys are not usable.';
    return off(`Push is off: check PUSH_VAPID_PUBLIC_KEY and PUSH_VAPID_PRIVATE_KEY. ${reason}`);
  }
  return { enabled: true, publicKey: keys.publicKey, vapid: { keys, subject } };
}

function off(message: string): PushConfig {
  return { enabled: false, message };
}

/** RFC 8292 section 2.1: a mailto: or https: contact URI. */
function isContact(subject: string): boolean {
  if (/^mailto:[^@\s]+@[^@\s]+$/.test(subject)) return true;
  try {
    return new URL(subject).protocol === 'https:';
  } catch {
    return false;
  }
}
