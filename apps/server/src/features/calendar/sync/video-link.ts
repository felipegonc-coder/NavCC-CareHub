// Finds an event's video meeting link in the places calendars put it. Join shows for Zoom
// (zoom.us, zoomgov.com), Google Meet (meet.google.com), Teams (teams.microsoft.com,
// teams.live.com, teams.cloud.microsoft, teams.microsoft.us) and Webex (webex.com) addresses
// (Calendar spec, Events). Used for iCalendar events and by the Google client.

export type VideoProvider = 'zoom' | 'google-meet' | 'teams' | 'webex';

export interface VideoLink {
  url: string;
  provider: VideoProvider;
}

export interface VideoLinkSources {
  conference?: readonly string[]; // CONFERENCE, X-GOOGLE-CONFERENCE, Google's entry points
  url?: string;
  location?: string;
  description?: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`{}|\\^]+/gi;
const MAX_SCAN = 100_000;

/** The first meeting link found, checking conference fields, URL, location, then description. */
export function findVideoLink(sources: VideoLinkSources): VideoLink | undefined {
  const texts = [...(sources.conference ?? []), sources.url, sources.location, sources.description];
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.slice(0, MAX_SCAN).matchAll(URL_PATTERN)) {
      const link = videoLinkFromUrl(match[0]);
      if (link) return link;
    }
  }
  return undefined;
}

/** Recognizes one URL as a meeting link, unwrapping Google and Outlook redirect links. */
export function videoLinkFromUrl(raw: string, depth = 0): VideoLink | undefined {
  let url: URL;
  try {
    url = new URL(raw.replace(/&amp;/g, '&').replace(/[.,;:!?)\]]+$/, ''));
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (url.username || url.password) return undefined;
  const host = url.hostname.toLowerCase();
  const wrapped =
    (host === 'www.google.com' && url.pathname === '/url' && url.searchParams.get('q')) ||
    (host.endsWith('.safelinks.protection.outlook.com') && url.searchParams.get('url'));
  if (wrapped) return depth < 2 ? videoLinkFromUrl(wrapped, depth + 1) : undefined;
  const provider = providerOf(host, url.pathname);
  if (!provider) return undefined;
  url.protocol = 'https:';
  return { url: url.href, provider };
}

const TEAMS_HOSTS = new Set(['teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft']);

/** The host is the domain or one of its subdomains. */
const within = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

function providerOf(host: string, path: string): VideoProvider | undefined {
  if (within(host, 'zoom.us') || within(host, 'zoomgov.com')) {
    return /^\/(j|my|s|w|wc\/join|wc\/\d+)\/[\w.-]+/i.test(path) ? 'zoom' : undefined;
  }
  if (host === 'meet.google.com') {
    return /^\/([a-z]{3}-[a-z]{4}-[a-z]{3}|lookup\/[\w-]+)$/i.test(path)
      ? 'google-meet'
      : undefined;
  }
  if (TEAMS_HOSTS.has(host) || within(host, 'teams.microsoft.us')) {
    return /^\/(l\/meetup-join|meet|l\/meet)\/./i.test(path) ? 'teams' : undefined;
  }
  if (host.endsWith('.webex.com')) {
    return /^\/(([\w-]+\/)?j\.php$|meet\/[\w.-]+|wbxmjs\/joinservice\/.)/i.test(path)
      ? 'webex'
      : undefined;
  }
  return undefined;
}
