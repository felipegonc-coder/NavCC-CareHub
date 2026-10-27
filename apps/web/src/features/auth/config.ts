/**
 * Whether signed-out people are sent to the sign-in screen before the app shell. Off until the
 * sign-in API and the seeded people are on main (accounts 1c): until then the shell opens signed
 * out, so the browser tests can still open every screen. Turn it on together with `signIn` in
 * tests/e2e/flows/_support/features.ts.
 */
export const SIGN_IN_REQUIRED = false;

/** The sign-in request: `{ email, password }`; the session cookie comes back with the answer. */
export const SIGN_IN_API = '/api/auth/sign-in';

export const SIGN_OUT_API = '/api/auth/sign-out';
