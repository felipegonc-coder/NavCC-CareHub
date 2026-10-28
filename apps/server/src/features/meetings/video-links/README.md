# Video links (server)

Zoom, Microsoft Teams and Google Meet links for Care Hub events (Meetings spec, MT-17; Calendar's
Join, CA-14 and CA-18). In the event panel, Add video link makes a meeting at the provider as the
person, and its join link goes in the event's video link. Each person signs in with their own
account. Care Hub never writes to anyone's calendar at the provider.

So far: the provider interface, sign-in with PKCE, sealed tokens and the Zoom adapter. The routes
(connect, callback, disconnect, make a link, the Admin's switches), Microsoft Teams and Google
Meet come next. Nothing here is reachable yet.

## Off until set up and turned on

A provider is offered only when both are true:

1. The server has its settings (`docs/team/settings.md`): its client ID and secret,
   `MEETINGS_SECRET_KEY` and `CAREHUB_PUBLIC_URL` (`settings.ts`). Otherwise the screens say
   "Zoom isn't set up yet."
2. An Admin turned it on for the workspace: `meetings.zoomLinks`, `meetings.teamsLinks` or
   `meetings.googleMeetLinks` (`PROVIDER_SWITCHES`). True is on; missing is off.

## Providers (`types.ts`)

`createLink(accessToken, { title, start, end, timeZone })` returns `{ provider, url, providerId }`:
`zoom`, `teams` or `google-meet` as Calendar names them, the join link, and the provider's own id
for the meeting. It throws `ProviderError`, whose kind is `reconnect` (the sign-in has ended),
`client-rejected` (wrong client ID or secret), `temporary` (no answer, busy, 5xx) or `failed`.

- Calls (`http.ts`) time out after 10 seconds, don't follow redirects and read at most 256 KB.
  Tokens go in headers and bodies only, never in URLs, and nothing here logs.
- A join link must be https:// on the provider's own hosts and their subdomains (Zoom: zoom.us and
  zoomgov.com), without a port or a user name.

## Signing in (`oauth.ts`)

Authorization code with PKCE (S256), a random 32-byte state and verifier for each sign-in. The
provider sees the state and the challenge, never the verifier. With the routes, the server keeps
the sign-in for 10 minutes, tied to the person and their session, and takes it once. Refreshing
keeps the new refresh token when the provider sends one (Zoom always does, and the old one stops
working); a refused refresh means connecting again. Disconnect asks the provider to withdraw the
sign-in when it has a way (Zoom does). That's best effort: the tokens are deleted here either way.

## Sealed values (`secrets.ts`)

Tokens and sign-in verifiers are sealed with `MEETINGS_SECRET_KEY`: AES-256-GCM, a new random
12-byte nonce each time, a 16-byte tag, and a context as associated data
(`meetings-video:<connectionId>`, `meetings-video-sign-in:<stateHash>`), so a sealed value only
opens for its own row. The format is Calendar's: `v1.` + base64url(nonce | tag | ciphertext), and
opening checks the shape too. The key is separate from `CALENDAR_SECRET_KEY`, so either can change
without touching the other's tokens; a new key means people connect again.

## Zoom (`zoom.ts`)

A user-managed General app in the Zoom App Marketplace, with the scope `meeting:write:meeting` and
the redirect URL `<CAREHUB_PUBLIC_URL>/api/meetings/video-links/zoom/callback`. A link is a
scheduled meeting in the person's own Zoom account (`POST /v2/users/me/meetings`): the event's
title (at most 200 characters, "(No title)" when blank), its start in UTC, its length in whole
minutes and its time zone.

## Tests

`testing.ts` has a stand-in Zoom on 127.0.0.1 (sign-in, refresh, revoke and new meetings), with a
client ID and secret made for each run. Like Zoom, it checks the PKCE verifier against the
challenge and lets each refresh token work once.
