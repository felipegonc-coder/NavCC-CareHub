import { describe, expect, it } from 'vitest';
import { findVideoLink, videoLinkFromUrl } from './video-link';

describe('videoLinkFromUrl', () => {
  it('recognizes meeting links', () => {
    const cases: [string, string][] = [
      ['https://zoom.us/j/5550100123', 'zoom'],
      ['https://us06web.zoom.us/j/5550100123?context=example', 'zoom'],
      ['https://example.zoom.us/my/avery.lin', 'zoom'],
      ['https://zoom.us/wc/join/5550100123', 'zoom'],
      ['https://meet.google.com/abc-defg-hij', 'google-meet'],
      ['https://meet.google.com/lookup/bakery-standup', 'google-meet'],
      ['https://teams.microsoft.com/l/meetup-join/19%3ameeting_example%40thread.v2/0', 'teams'],
      ['https://teams.microsoft.com/meet/5550100123?p=example', 'teams'],
      ['https://teams.live.com/meet/9876543210', 'teams'],
      ['https://zoomgov.com/j/5550100123', 'zoom'],
      ['https://example.zoomgov.com/j/5550100123?context=example', 'zoom'],
      ['https://teams.cloud.microsoft/l/meetup-join/19%3ameeting_example%40thread.v2/0', 'teams'],
      ['https://gov.teams.microsoft.us/l/meetup-join/19%3ameeting_example%40thread.v2/0', 'teams'],
      ['https://example.webex.com/meet/riley.chen', 'webex'],
      ['https://example.webex.com/example/j.php?MTID=m0123456789abcdef', 'webex'],
      ['https://example.webex.com/wbxmjs/joinservice/sites/example/meeting/download/abc', 'webex'],
    ];
    for (const [url, provider] of cases) {
      expect(videoLinkFromUrl(url)).toEqual({ url, provider });
    }
  });

  it('ignores other pages, other services and look-alike hosts', () => {
    for (const url of [
      'https://zoom.us/',
      'https://zoom.us/download',
      'https://meet.google.com/',
      'https://meet.google.com/new',
      'https://teams.microsoft.com/meetingOptions/?organizerId=example',
      'https://dialin.teams.microsoft.com/example',
      'https://www.webex.com/pricing',
      'https://webex.com.example.net/meet/riley.chen',
      'https://example.zoomgov.com/download',
      'https://notzoomgov.com/j/5550100123',
      'https://teams.cloud.microsoft.example.org/l/meetup-join/example',
      'https://zoom.us.example.net/j/5550100123',
      'https://example.com/zoom.us/j/5550100123',
      'https://avery@zoom.us/j/5550100123',
      'ftp://zoom.us/j/5550100123',
      'not a link',
    ]) {
      expect(videoLinkFromUrl(url)).toBeUndefined();
    }
  });

  it('upgrades http, trims trailing punctuation and decodes &amp;', () => {
    expect(videoLinkFromUrl('http://zoom.us/j/5550100123).')?.url).toBe(
      'https://zoom.us/j/5550100123',
    );
    expect(
      videoLinkFromUrl('https://zoom.us/j/5550100123?context=example&amp;from=addon')?.url,
    ).toBe('https://zoom.us/j/5550100123?context=example&from=addon');
  });

  it('unwraps Google and Outlook redirect links', () => {
    expect(
      videoLinkFromUrl('https://www.google.com/url?q=https%3A%2F%2Fzoom.us%2Fj%2F5550100123&sa=D'),
    ).toEqual({ url: 'https://zoom.us/j/5550100123', provider: 'zoom' });
    expect(
      videoLinkFromUrl(
        'https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fteams.microsoft.com%2Fl%2Fmeetup-join%2Fexample&data=05',
      ),
    ).toEqual({ url: 'https://teams.microsoft.com/l/meetup-join/example', provider: 'teams' });
    const wrap = (url: string) => `https://www.google.com/url?q=${encodeURIComponent(url)}`;
    expect(videoLinkFromUrl(wrap(wrap(wrap('https://zoom.us/j/5550100123'))))).toBeUndefined();
  });
});

describe('findVideoLink', () => {
  it('checks conference fields, then URL, then location, then description', () => {
    const zoom = 'https://zoom.us/j/5550100123';
    const meet = 'https://meet.google.com/abc-defg-hij';
    expect(findVideoLink({ conference: [meet], url: zoom })?.url).toBe(meet);
    expect(findVideoLink({ url: zoom, location: meet })?.url).toBe(zoom);
    expect(findVideoLink({ location: meet, description: zoom })?.url).toBe(meet);
    expect(
      findVideoLink({
        location: 'Bluebird Bakery, back room',
        description: `Menu: https://www.example.com/menu\nJoin: <${zoom}>\nDial in: +1 555 0100`,
      }),
    ).toEqual({ url: zoom, provider: 'zoom' });
  });

  it('returns undefined when there is no meeting link', () => {
    expect(findVideoLink({})).toBeUndefined();
    expect(findVideoLink({ url: 'https://www.example.org/', description: 'Room 2' })).toBe(
      undefined,
    );
  });
});
