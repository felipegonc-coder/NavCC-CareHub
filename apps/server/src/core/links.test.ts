import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { createTestApp, hasDatabase, type TestApp } from '../testing';
import { createLinks, webAddressOf, webAddressProblem } from './links';

const DATABASE_URL = 'postgres://carehub@localhost:5432/carehub';
const ADDRESS = 'https://carehub.example.test';

const webAddress = (value: string, env: Record<string, string> = {}) =>
  loadConfig({ DATABASE_URL, ...env, CAREHUB_PUBLIC_URL: value }).CAREHUB_PUBLIC_URL;

describe('the web address setting (CAREHUB_PUBLIC_URL)', () => {
  it('is kept as just the address: lowercase, no default port, no slash at the end', () => {
    expect(webAddress(ADDRESS)).toBe(ADDRESS);
    expect(webAddress(`${ADDRESS}/`)).toBe(ADDRESS);
    expect(webAddress('HTTPS://CareHub.Example.TEST:443/')).toBe(ADDRESS);
    expect(webAddress('https://carehub.example.test:8443')).toBe(
      'https://carehub.example.test:8443',
    );
    expect(webAddress('http://localhost:5173/')).toBe('http://localhost:5173');
    expect(webAddress('http://[::1]:3000')).toBe('http://[::1]:3000');
  });

  it('refuses a path, a query or a fragment after the address', () => {
    for (const value of [
      `${ADDRESS}/care`,
      `${ADDRESS}/care/`,
      `${ADDRESS}/?team=1`,
      `${ADDRESS}?team=1`,
      `${ADDRESS}/#top`,
    ]) {
      expect(() => webAddress(value), value).toThrow(
        /CAREHUB_PUBLIC_URL to just the address, like https:\/\/carehub\.example\.test,/,
      );
    }
  });

  it('refuses a user name or password, without repeating them', () => {
    const withName = new URL(ADDRESS);
    withName.username = 'fictional-name';
    const withPassword = new URL(withName);
    withPassword.password = 'fictional-password';
    for (const value of [withName.href, withPassword.href]) {
      let message = '';
      try {
        webAddress(value);
      } catch (error) {
        message = String(error);
      }
      expect(message).toMatch(/CAREHUB_PUBLIC_URL can't have a user name or password/);
      expect(message).not.toMatch(/fictional-(name|password)/);
    }
  });

  it('refuses anything that is not an http or https address', () => {
    for (const value of [
      'carehub.example.test',
      'ftp://carehub.example.test',
      'mailto:team@example.test',
    ]) {
      expect(() => webAddress(value), value).toThrow(/CAREHUB_PUBLIC_URL to a web address like/);
    }
  });

  it('still needs https in production, except on this computer', () => {
    const production = { NODE_ENV: 'production' };
    expect(webAddress(`${ADDRESS}/`, production)).toBe(ADDRESS);
    expect(() => webAddress('http://carehub.example.test', production)).toThrow(/https:\/\//);
    expect(webAddress('http://127.0.0.1:38080/', { ...production, COOKIE_SECURE: 'false' })).toBe(
      'http://127.0.0.1:38080',
    );
  });

  it('webAddressProblem leaves other mistakes to the URL check', () => {
    expect(webAddressProblem(ADDRESS)).toBeNull();
    expect(webAddressProblem(` ${ADDRESS}/ `)).toBeNull();
    expect(webAddressProblem('carehub')).toBeNull();
    expect(webAddressProblem('ftp://carehub.example.test/files')).toBeNull();
    expect(webAddressProblem(`${ADDRESS}/care`)).toMatch(/just the address/);
  });
});

describe('webAddressOf', () => {
  it('uses CAREHUB_PUBLIC_URL, or this computer when it is unset (never in production)', () => {
    expect(webAddressOf({ CAREHUB_PUBLIC_URL: ADDRESS, PORT: 3000 })).toBe(ADDRESS);
    expect(webAddressOf({ PORT: 3000 })).toBe('http://localhost:3000');
    expect(webAddressOf(loadConfig({ DATABASE_URL, PORT: '8080' }))).toBe('http://localhost:8080');
  });
});

describe('createLinks', () => {
  const links = createLinks(`${ADDRESS}/`);

  it('makes full links from Care Hub paths', () => {
    expect(links.origin).toBe(ADDRESS);
    expect(links.to('/p/0b7c')).toBe(`${ADDRESS}/p/0b7c`);
    expect(links.to('/p/0b7c#block-12')).toBe(`${ADDRESS}/p/0b7c#block-12`);
    expect(links.to('/calendar?event=7')).toBe(`${ADDRESS}/calendar?event=7`);
  });

  it('encodes query values and leaves out empty ones', () => {
    expect(
      links.to('/p/0b7c#comment-3', {
        view: 'board & list',
        page: 2,
        open: true,
        skipped: undefined,
        none: null,
      }),
    ).toBe(`${ADDRESS}/p/0b7c?view=board+%26+list&page=2&open=true#comment-3`);
    expect(links.to('/reset?token=old', { token: 'fictional/token=' })).toBe(
      `${ADDRESS}/reset?token=fictional%2Ftoken%3D`,
    );
  });

  it('keeps a port that is not the default', () => {
    expect(createLinks('http://localhost:5173').to('/p/1')).toBe('http://localhost:5173/p/1');
  });

  it('refuses anything that could point somewhere else, without repeating it', () => {
    for (const path of [
      '',
      'p/0b7c',
      '//elsewhere.example.test/p/1',
      '/\\elsewhere.example.test',
      '\\\\elsewhere.example.test',
      'https://elsewhere.example.test/p/1',
      'javascript:alert(1)',
      '/p/two words',
      '/p/\tfictional-token',
      '/p/\nfictional-token',
      '/p/\u0000',
      '/p/\u00a0',
    ]) {
      expect(() => links.to(path), JSON.stringify(path)).toThrow(RangeError);
      expect(() => links.to(path)).not.toThrow(/fictional-token|elsewhere/);
    }
  });

  it('tells its own links from others', () => {
    expect(links.isOwn(`${ADDRESS}/p/1`)).toBe(true);
    expect(links.isOwn(`${ADDRESS}:443/p/1`)).toBe(true);
    expect(links.isOwn('https://carehub.example.test:8443/p/1')).toBe(false);
    expect(links.isOwn('http://carehub.example.test/p/1')).toBe(false);
    expect(links.isOwn(`https://elsewhere.example.test/${ADDRESS}`)).toBe(false);
    expect(links.isOwn('/p/1')).toBe(false);
    expect(links.isOwn('not a link')).toBe(false);
  });

  it('needs an http or https address', () => {
    expect(() => createLinks('ftp://carehub.example.test')).toThrow(TypeError);
    expect(() => createLinks('carehub')).toThrow(TypeError);
  });
});

// The whole server needs Postgres (CI provides DATABASE_URL).
describe.skipIf(!hasDatabase)('app.links in the whole server', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({
      env: { CAREHUB_PUBLIC_URL: `${ADDRESS}/` },
      routes: (app) => {
        app.get('/api/test/link', { config: { public: true } }, async () => ({
          link: app.links.to('/p/0b7c'),
        }));
      },
    });
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('starts every link with the web address, whatever Host a request names', async () => {
    expect(testApp.app.links.origin).toBe(ADDRESS);
    for (const host of ['carehub.example.test', 'elsewhere.example.test', '127.0.0.1:3000']) {
      const response = await testApp.app.inject({
        method: 'GET',
        url: '/api/test/link',
        headers: { host, 'x-forwarded-host': 'elsewhere.example.test' },
      });
      expect(response.statusCode, host).toBe(200);
      expect(response.json(), host).toEqual({ link: `${ADDRESS}/p/0b7c` });
    }
  });

  it('uses this computer when CAREHUB_PUBLIC_URL is unset (tests and development)', async () => {
    const local = await createTestApp({ env: { PORT: '3999' } });
    try {
      expect(local.app.links.to('/p/0b7c')).toBe('http://localhost:3999/p/0b7c');
    } finally {
      await local.close();
    }
  });
});
