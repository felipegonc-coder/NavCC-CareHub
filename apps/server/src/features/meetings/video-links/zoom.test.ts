import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isHttpsLinkOn, ProviderError } from './http';
import { startFakeZoom, type FakeZoom } from './testing';
import { ZOOM_HOSTS, zoomMeeting, zoomProvider } from './zoom';

const huddle = {
  title: '  Team huddle  ',
  start: new Date('2026-10-29T16:00:00.000Z'),
  end: new Date('2026-10-29T16:30:00.000Z'),
  timeZone: 'America/Denver',
};

describe('Zoom meetings', () => {
  it('get the title, the UTC start, whole minutes and the time zone', () => {
    expect(zoomMeeting(huddle)).toEqual({
      topic: 'Team huddle',
      type: 2,
      start_time: '2026-10-29T16:00:00Z',
      duration: 30,
      timezone: 'America/Denver',
    });
    const short = { ...huddle, title: ' ', end: new Date('2026-10-29T16:00:20.000Z') };
    expect(zoomMeeting(short)).toMatchObject({ topic: '(No title)', duration: 1 });
    const long = { ...huddle, title: '🙂'.repeat(250), end: new Date('2026-10-29T16:45:30.000Z') };
    expect(Array.from(zoomMeeting(long).topic)).toHaveLength(200);
    expect(zoomMeeting(long).duration).toBe(46);
  });

  it('take join links only on https:// Zoom hosts', () => {
    expect(isHttpsLinkOn('https://us02web.zoom.us/j/81234567890?pwd=abc', ZOOM_HOSTS)).toBe(true);
    expect(isHttpsLinkOn('https://zoom.us/j/1', ZOOM_HOSTS)).toBe(true);
    expect(isHttpsLinkOn('https://example.zoomgov.com/j/1', ZOOM_HOSTS)).toBe(true);
    for (const link of [
      'http://zoom.us/j/1',
      'https://zoom.us.example.com/j/1',
      'https://notzoom.us/j/1',
      'https://zoom.us:8443/j/1',
      'https://someone@zoom.us/j/1',
      'javascript:alert(1)',
      'not a link',
    ]) {
      expect(isHttpsLinkOn(link, ZOOM_HOSTS)).toBe(false);
    }
  });

  describe('with a stand-in Zoom', () => {
    let zoom: FakeZoom;
    let accessToken: string;

    beforeAll(async () => {
      zoom = await startFakeZoom();
      accessToken = 'zat-example';
      zoom.accessTokens.add(accessToken);
    });
    afterAll(() => zoom.close());

    const refusal = async (status: number, body: unknown = {}) => {
      zoom.fail('/v2/users/me/meetings', status, body);
      const error = await zoomProvider(zoom.urls)
        .createLink(accessToken, huddle)
        .then(
          () => null,
          (reason: unknown) => reason,
        );
      return error instanceof ProviderError ? error.kind : error;
    };

    it('makes a meeting as the person and returns its join link', async () => {
      const link = await zoomProvider(zoom.urls).createLink(accessToken, huddle);
      expect(link.provider).toBe('zoom');
      expect(link.url).toMatch(/^https:\/\/us02web\.zoom\.us\/j\/\d+\?pwd=/);
      expect(link.providerId).toMatch(/^\d+$/);
      const request = zoom.requests.at(-1);
      expect(request?.path).toBe('/v2/users/me/meetings');
      expect(request?.authorization).toBe('Bearer zat-example');
      expect(JSON.parse(request?.body ?? '')).toEqual(zoomMeeting(huddle));
    });

    it('says what went wrong', async () => {
      expect(await refusal(401)).toBe('reconnect');
      expect(await refusal(429)).toBe('temporary');
      expect(await refusal(500)).toBe('temporary');
      expect(await refusal(400, { code: 300, message: 'Invalid meeting.' })).toBe('failed');
      expect(await refusal(201, { id: 1, join_url: 'https://zoom.us.example.com/j/1' })).toBe(
        'failed',
      );
      expect(await refusal(201, { id: 1 })).toBe('failed');
    });
  });
});
