# Google sign-in setup (Google Calendar, read-only)

Care Hub shows Google calendars by asking each person for **read-only** access: it can see their calendar list and events, and it never changes anything in Google. This page sets up the Google sign-in client once for the whole Care Hub server. It takes about 15 minutes and any Google account will do. The client doesn't have to belong to the people who connect.

## Before you start

- **Care Hub's address** (`CAREHUB_PUBLIC_URL` in `deploy/.env`), for example `https://carehub.example.org`. Google only accepts sign-in addresses that start with `https://` and end in a public domain (`.org`, `.com`, …). Addresses like `http://192.168.1.20` or `https://carehub.local` won't work. See "When something goes wrong" below.
- **Care Hub on Tailscale:** use the full HTTPS name, such as `https://carehub.tail1234.ts.net`. Google only sends the person's browser back to that address, and the browser is on the tailnet; Google never connects to Care Hub. If Google asks for an authorized domain, add the part after the machine name (`tail1234.ts.net`).
- `CALENDAR_SECRET_KEY` is set (see [settings.md](settings.md)). Without it, Care Hub can't store connections.

## 1. Make a project

1. Open the Google Cloud console (console.cloud.google.com) and sign in.
2. Open the project picker, choose **New project**, name it `Care Hub` and create it. Make sure it's selected.

## 2. Turn on the Google Calendar API

Go to **APIs & Services → Library**, search for **Google Calendar API** and choose **Enable**.

## 3. Set up the consent screen

Go to **Google Auth Platform**. In older consoles it's **APIs & Services → OAuth consent screen**.

1. **Branding**: app name `Care Hub`, a support email and a developer contact email.
2. **Audience**: user type **External**. Choose Internal only if everyone uses the same Google Workspace organisation. Then choose **Publish app** so the publishing status is **In production**. In **Testing**, only listed test users can sign in, and Google ends every sign-in after 7 days.
3. **Data access**: choose **Add or remove scopes**, add these two and save:
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly` (see the list of calendars)
   - `https://www.googleapis.com/auth/calendar.events.readonly` (view events)

A family or a small team doesn't need Google's app verification. Before verification, up to 100 people can sign in. They first see "Google hasn't verified this app" and choose **Advanced → Go to Care Hub**.

## 4. Make the client

Go to **Clients** (older consoles: **Credentials → Create credentials → OAuth client ID**):

- **Application type**: Web application
- **Name**: `Care Hub`
- **Authorized JavaScript origins**: leave empty
- **Authorized redirect URIs**: `<CAREHUB_PUBLIC_URL>/api/calendar/google/callback`, for example `https://carehub.example.org/api/calendar/google/callback`. It must match exactly: no slash at the end.

Choose **Create**, then copy the **Client ID** and **Client secret** straight away. Google may show the secret only once. If it's lost, add a new secret to the same client.

## 5. Give them to Care Hub

On the server, in `deploy/.env`:

```sh
GOOGLE_CLIENT_ID=<the client ID>
GOOGLE_CLIENT_SECRET=<the client secret>
```

Restart Care Hub so it reads them. The secret stays in that file. Never put it in the repository, a chat or a screenshot.

## 6. Check it

In Care Hub, open **Calendar → Connect calendar → Google**, sign in, allow both boxes and pick the calendars to show. Their events appear within a few minutes.

## When something goes wrong

| What you see                                                                                             | What to do                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Google sign-in isn't set up yet."                                                                       | `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is empty. Set both and restart Care Hub.                                                                                                                                                                                                                                                                                              |
| Google shows **Error 400: redirect_uri_mismatch**                                                        | The redirect URI in step 4 must be `CAREHUB_PUBLIC_URL` followed by `/api/calendar/google/callback`, with the same `https`, host name and port, and no slash at the end.                                                                                                                                                                                                           |
| Google won't save the redirect URI ("must use https", "must end with a public top-level domain")         | Google sign-in needs a public `https://` address for Care Hub. Until there is one, add the calendar as a private link (next row). Another way for these servers is planned.                                                                                                                                                                                                        |
| Work or school account: "Access blocked" or "admin"                                                      | The organisation only allows apps its admin has approved. The admin can allow Care Hub's client ID in the Google Admin console (**Security → Access and data control → API controls**). Meanwhile, if the calendar has one, use its secret address (Google Calendar → **Settings** → the calendar → **Integrate calendar** → **Secret address in iCal format**) as a private link. |
| "Google didn't accept Care Hub's sign-in settings. Check the Google client ID, secret and redirect URL." | The ID or secret was copied wrongly (watch for spaces), or the client was deleted. Copy them again, or add a new secret.                                                                                                                                                                                                                                                           |
| "The Google Calendar API isn't turned on for Care Hub's Google client."                                  | Do step 2 in the same project as the client, then wait a few minutes.                                                                                                                                                                                                                                                                                                              |
| "Care Hub needs to see your calendars and their events. Please connect again and allow both."            | A box was left unticked on Google's screen. Connect again and allow both.                                                                                                                                                                                                                                                                                                          |
| "Google needs you to sign in again." on a calendar                                                       | Google ended the sign-in: the person removed Care Hub from their Google Account, or the client is still in **Testing**. Choose **Reconnect**. If this happens every week, publish the app (step 3).                                                                                                                                                                                |
| "Access blocked: Care Hub has not completed the Google verification process"                             | The client is in **Testing** and the person isn't a test user. Publish the app (step 3).                                                                                                                                                                                                                                                                                           |
