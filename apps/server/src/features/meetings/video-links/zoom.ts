// Zoom: a scheduled meeting in the person's own Zoom account (POST /v2/users/me/meetings). The
// Zoom app is a user-managed General app with the scope meeting:write:meeting (README.md).
import { z } from 'zod';
import { apiError, isHttpsLinkOn, ProviderError, readJson, send, type Fetch } from './http';
import type { CreateLinkInput, VideoLinkProvider } from './types';

export const ZOOM_URLS = {
  authorize: 'https://zoom.us/oauth/authorize',
  token: 'https://zoom.us/oauth/token',
  revoke: 'https://zoom.us/oauth/revoke',
  api: 'https://api.zoom.us/v2',
};
export type ZoomUrls = typeof ZOOM_URLS;

/** Zoom's join links are on these hosts and their subdomains, such as us02web.zoom.us. */
export const ZOOM_HOSTS = ['zoom.us', 'zoomgov.com'];

const meetingAnswer = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,20}$/)]),
  join_url: z
    .string()
    .max(2000)
    .refine((url) => isHttpsLinkOn(url, ZOOM_HOSTS)),
});

/** The meeting Zoom makes: the title (200 characters at most), the UTC start, whole minutes. */
export function zoomMeeting({ title, start, end, timeZone }: CreateLinkInput) {
  return {
    topic: Array.from(title.trim()).slice(0, 200).join('') || '(No title)',
    type: 2,
    start_time: start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    duration: Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 60_000)),
    timezone: timeZone,
  };
}

export function zoomProvider(
  urls: ZoomUrls = ZOOM_URLS,
  fetcher: Fetch = fetch,
): VideoLinkProvider {
  return {
    id: 'zoom',
    oauth: {
      authorizeUrl: urls.authorize,
      tokenUrl: urls.token,
      revokeUrl: urls.revoke,
      scopes: [],
      clientAuth: 'basic',
    },
    async createLink(accessToken, input) {
      const response = await send(fetcher, `${urls.api}/users/me/meetings`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(zoomMeeting(input)),
      });
      const answer = await readJson(response);
      if (!response.ok) throw apiError(response.status);
      const meeting = meetingAnswer.safeParse(answer);
      if (!meeting.success) throw new ProviderError('failed', response.status);
      return { provider: 'zoom', url: meeting.data.join_url, providerId: String(meeting.data.id) };
    },
  };
}
