import { describe, expect, it } from 'vitest';
import { generateVapidKeys } from './protocol/vapid';
import { PUSH_OFF_MESSAGE, pushSettingsSchema, resolvePushConfig } from './settings';

const subject = 'mailto:care-team@example.org';

describe('resolvePushConfig', () => {
  it('switches push off with a plain message when nothing is set', () => {
    expect(resolvePushConfig({})).toEqual({ enabled: false, message: PUSH_OFF_MESSAGE });
    expect(
      resolvePushConfig({
        PUSH_VAPID_PUBLIC_KEY: '',
        PUSH_VAPID_PRIVATE_KEY: ' ',
        PUSH_VAPID_SUBJECT: '',
      }),
    ).toEqual({
      enabled: false,
      message: PUSH_OFF_MESSAGE,
    });
  });

  it('names the settings that are missing', () => {
    const keys = generateVapidKeys();
    const config = resolvePushConfig({ PUSH_VAPID_PUBLIC_KEY: keys.publicKey });
    expect(config).toEqual({
      enabled: false,
      message: `${PUSH_OFF_MESSAGE} Missing: PUSH_VAPID_PRIVATE_KEY, PUSH_VAPID_SUBJECT.`,
    });
  });

  it('refuses a subject that is not a mailto: or https: address', () => {
    const keys = generateVapidKeys();
    for (const bad of ['care-team@example.org', 'http://example.org', 'mailto:nobody']) {
      const config = resolvePushConfig({
        PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
        PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
        PUSH_VAPID_SUBJECT: bad,
      });
      expect(config).toMatchObject({ enabled: false });
      expect(JSON.stringify(config)).toContain('PUSH_VAPID_SUBJECT');
    }
    const https = resolvePushConfig({
      PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
      PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
      PUSH_VAPID_SUBJECT: 'https://care.example.org',
    });
    expect(https.enabled).toBe(true);
  });

  it('switches off for unusable or mismatched keys without showing them', () => {
    const a = generateVapidKeys();
    const b = generateVapidKeys();
    for (const privateKey of [b.privateKey, `${a.privateKey}x`, 'not a key']) {
      const config = resolvePushConfig({
        PUSH_VAPID_PUBLIC_KEY: a.publicKey,
        PUSH_VAPID_PRIVATE_KEY: privateKey,
        PUSH_VAPID_SUBJECT: subject,
      });
      expect(config.enabled).toBe(false);
      expect(JSON.stringify(config)).not.toContain(privateKey);
      expect(JSON.stringify(config)).not.toContain(a.privateKey);
    }
  });

  it('turns push on with usable keys and never serialises the private key', () => {
    const keys = generateVapidKeys();
    const config = resolvePushConfig({
      PUSH_VAPID_PUBLIC_KEY: ` ${keys.publicKey} `,
      PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
      PUSH_VAPID_SUBJECT: subject,
    });
    expect(config).toMatchObject({ enabled: true, publicKey: keys.publicKey, vapid: { subject } });
    expect(JSON.stringify(config)).not.toContain(keys.privateKey);
  });
});

describe('pushSettingsSchema', () => {
  it('accepts any strings, so a typo never stops the server', () => {
    const parsed = pushSettingsSchema.parse({ PUSH_VAPID_PUBLIC_KEY: '%%%', PORT: '3000' });
    expect(parsed).toEqual({ PUSH_VAPID_PUBLIC_KEY: '%%%' });
  });
});
