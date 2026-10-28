// Video links for Care Hub events: the providers, and what an adapter does. See README.md.

/** The providers, named as Calendar names video links (calendar/sync/video-link.ts). */
export const VIDEO_PROVIDERS = ['zoom', 'teams', 'google-meet'] as const;
export type VideoProviderId = (typeof VIDEO_PROVIDERS)[number];

export const PROVIDER_LABELS: Readonly<Record<VideoProviderId, string>> = {
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
  'google-meet': 'Google Meet',
};

/** The Admin's switch for each provider, a workspace setting: true is on, anything else off. */
export const PROVIDER_SWITCHES: Readonly<Record<VideoProviderId, string>> = {
  zoom: 'meetings.zoomLinks',
  teams: 'meetings.teamsLinks',
  'google-meet': 'meetings.googleMeetLinks',
};

/** The Care Hub event a link is for. */
export interface CreateLinkInput {
  title: string;
  start: Date;
  end: Date;
  /** The event's time zone, such as America/Denver. */
  timeZone: string;
}

/** A join link the provider made; `providerId` is the provider's own id for the meeting. */
export interface CreatedLink {
  provider: VideoProviderId;
  url: string;
  providerId: string;
}

/** A person's tokens from signing in to a provider. Sealed at rest, never sent to the browser. */
export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** When the access token ends, in milliseconds since 1970. */
  expiresAt: number;
}

/** How a person signs in to the provider: authorization code with PKCE (S256). */
export interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  /** Where disconnecting withdraws the sign-in, when the provider has one. */
  revokeUrl?: string;
  /** Asked for on the consent screen. Zoom's are chosen in the Zoom app instead. */
  scopes: readonly string[];
  /** How the server shows the client secret: HTTP Basic (Zoom) or form fields. */
  clientAuth: 'basic' | 'body';
  /** More authorize parameters, such as a prompt. */
  authorizeParams?: Readonly<Record<string, string>>;
}

/** A provider adapter. Each person signs in with their own account, and links are made as them. */
export interface VideoLinkProvider {
  id: VideoProviderId;
  oauth: OAuthConfig;
  /** Makes a meeting for the event with the person's access token. Throws ProviderError. */
  createLink(accessToken: string, input: CreateLinkInput): Promise<CreatedLink>;
}
