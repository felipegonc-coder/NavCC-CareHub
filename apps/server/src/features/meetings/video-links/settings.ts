// Server settings for video links (docs/team/settings.md). A provider is set up when it has a client
// ID and secret, MEETINGS_SECRET_KEY seals the tokens, and CAREHUB_PUBLIC_URL makes the redirect URL.
import { z } from 'zod';
import { readSettings, type ReadSettingsOptions } from '../../../core/settings';
import type { OAuthClient } from './oauth';
import type { VideoProviderId } from './types';

const clientValue = z.string().trim().min(1).max(500);

const settingsSchema = z.object({
  CAREHUB_PUBLIC_URL: z.url({ protocol: /^https?$/ }).optional(),
  MEETINGS_SECRET_KEY: z
    .string()
    .regex(/^[A-Za-z0-9+/]{43}=$/, 'use 32 random bytes in base64: openssl rand -base64 32')
    .optional(),
  ZOOM_CLIENT_ID: clientValue.optional(),
  ZOOM_CLIENT_SECRET: clientValue.optional(),
});

export interface VideoLinkSettings {
  /** Seals tokens and sign-ins. Null when MEETINGS_SECRET_KEY isn't set: nothing is set up. */
  key: Buffer | null;
  /** The client of each provider that's set up. The others are "not set up yet". */
  clients: Partial<Record<VideoProviderId, OAuthClient>>;
}

/** Where the provider sends the person back: the redirect URL to give each provider's app. */
export const callbackPath = (provider: VideoProviderId) =>
  `/api/meetings/video-links/${provider}/callback`;

export function readVideoLinkSettings(options?: ReadSettingsOptions): VideoLinkSettings {
  const settings = readSettings(settingsSchema, options);
  const key = settings.MEETINGS_SECRET_KEY
    ? Buffer.from(settings.MEETINGS_SECRET_KEY, 'base64')
    : null;
  const origin = settings.CAREHUB_PUBLIC_URL?.replace(/\/+$/, '');
  const clients: VideoLinkSettings['clients'] = {};
  const client = (provider: VideoProviderId, clientId?: string, clientSecret?: string) => {
    if (!key || !origin || !clientId || !clientSecret) return;
    clients[provider] = { clientId, clientSecret, redirectUri: origin + callbackPath(provider) };
  };
  client('zoom', settings.ZOOM_CLIENT_ID, settings.ZOOM_CLIENT_SECRET);
  return { key, clients };
}
