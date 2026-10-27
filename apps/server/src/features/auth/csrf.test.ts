import { describe, expect, it } from 'vitest';
import { checkCsrf, csrfTokenForSession, isAllowedOrigin, newCsrfToken } from './csrf';

describe('isAllowedOrigin', () => {
  it('accepts no Origin, or one that matches CAREHUB_PUBLIC_URL, or else the Host header', () => {
    expect(isAllowedOrigin(undefined, 'carehub.example.test', null)).toBe(true);
    expect(isAllowedOrigin('https://carehub.example.test', 'carehub.example.test', null)).toBe(
      true,
    );
    expect(isAllowedOrigin('http://localhost:5173', 'localhost:3000', null)).toBe(false);
    expect(isAllowedOrigin('https://elsewhere.example.test', 'carehub.example.test', null)).toBe(
      false,
    );
    expect(isAllowedOrigin('null', 'carehub.example.test', null)).toBe(false);
    const publicOrigin = 'https://carehub.example.test';
    expect(isAllowedOrigin('https://carehub.example.test', 'localhost:3000', publicOrigin)).toBe(
      true,
    );
    expect(isAllowedOrigin('http://localhost:3000', 'localhost:3000', publicOrigin)).toBe(false);
  });
});

describe('checkCsrf', () => {
  it('needs a header that matches the cookie, and the session once signed in', () => {
    const token = newCsrfToken();
    const base = {
      method: 'POST',
      origin: undefined,
      host: 'localhost',
      publicOrigin: null,
      header: token,
      cookie: token,
      sessionToken: undefined,
    };
    expect(checkCsrf(base)).toBeNull();
    expect(checkCsrf({ ...base, method: 'GET', header: undefined, cookie: undefined })).toBeNull();
    expect(checkCsrf({ ...base, header: undefined })).toBe('token');
    expect(checkCsrf({ ...base, header: newCsrfToken() })).toBe('token');
    expect(checkCsrf({ ...base, header: [token, token] })).toBe('token');
    expect(checkCsrf({ ...base, origin: 'https://elsewhere.example.test' })).toBe('origin');

    const sessionToken = newCsrfToken();
    expect(checkCsrf({ ...base, sessionToken })).toBe('token');
    const bound = csrfTokenForSession(sessionToken);
    expect(checkCsrf({ ...base, header: bound, cookie: bound, sessionToken })).toBeNull();
  });
});
