// What other features may use from accounts (decision 0007, section 3.1).
// The co-editing server: getUserFromSessionToken(db, app.sessionCookies.sessionToken(request)). The cookie
// names depend on COOKIE_SECURE (authCookieNames), so don't hard-code carehub_session.
export { authCookieNames, type AuthCookieNames } from './cookies';
export { getUserFromSessionToken } from './sessions';
export type { Guard } from './plugin';
export type { CurrentMember } from '../workspaces';
