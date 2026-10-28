import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readVideoLinkSettings } from './settings';

const key = randomBytes(32).toString('base64');
const quiet = { warn: () => {} };

describe('video link settings', () => {
  it('sets up nothing without them', () => {
    expect(readVideoLinkSettings({ env: {}, log: quiet })).toEqual({ key: null, clients: {} });
  });

  it('sets up Zoom with its client, the key and the public address', () => {
    const settings = readVideoLinkSettings({
      env: {
        CAREHUB_PUBLIC_URL: 'https://carehub.example.com/',
        MEETINGS_SECRET_KEY: key,
        ZOOM_CLIENT_ID: 'zoom-client-example',
        ZOOM_CLIENT_SECRET: 'zoom-secret-example',
      },
      log: quiet,
    });
    expect(settings.key).toHaveLength(32);
    expect(settings.clients.zoom).toEqual({
      clientId: 'zoom-client-example',
      clientSecret: 'zoom-secret-example',
      redirectUri: 'https://carehub.example.com/api/meetings/video-links/zoom/callback',
    });
  });

  it('leaves Zoom off when the key, the address or the secret is missing', () => {
    const all = {
      CAREHUB_PUBLIC_URL: 'https://carehub.example.com',
      MEETINGS_SECRET_KEY: key,
      ZOOM_CLIENT_ID: 'zoom-client-example',
      ZOOM_CLIENT_SECRET: 'zoom-secret-example',
    };
    for (const name of Object.keys(all)) {
      const env = { ...all, [name]: '' };
      expect(readVideoLinkSettings({ env, log: quiet }).clients.zoom).toBeUndefined();
    }
  });

  it('ignores a key that is not 32 bytes, without showing it', () => {
    const warnings: string[] = [];
    const short = randomBytes(16).toString('base64');
    const settings = readVideoLinkSettings({
      env: { MEETINGS_SECRET_KEY: short },
      log: { warn: (message) => void warnings.push(message) },
    });
    expect(settings.key).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('MEETINGS_SECRET_KEY');
    expect(warnings[0]).not.toContain(short);
  });
});
