import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const DATABASE_URL = 'postgres://carehub@localhost:5432/carehub';

describe('loadConfig', () => {
  it('needs DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://localhost/carehub' })).toThrow(/DATABASE_URL/);
  });

  it('uses defaults for everything else', () => {
    const config = loadConfig({ DATABASE_URL });
    expect(config).toMatchObject({
      PORT: 3000,
      HOST: '0.0.0.0',
      CAREHUB_VERSION: '0.0.0-dev',
      NODE_ENV: 'development',
      DATABASE_URL,
      COOKIE_SECURE: true,
    });
    expect(config.CAREHUB_PUBLIC_URL).toBeUndefined();
    expect(isAbsolute(config.WEB_DIST_DIR)).toBe(true);
    expect(config.WEB_DIST_DIR.replaceAll('\\', '/')).toMatch(/\/apps\/web\/dist$/);
  });

  it('reads environment values and treats empty ones as unset', () => {
    const config = loadConfig({
      PORT: '8080',
      HOST: '',
      CAREHUB_VERSION: '1.2.3',
      NODE_ENV: 'production',
      DATABASE_URL,
      CAREHUB_PUBLIC_URL: 'https://carehub.example.test',
      COOKIE_SECURE: 'false',
    });
    expect(config).toMatchObject({
      PORT: 8080,
      HOST: '0.0.0.0',
      CAREHUB_VERSION: '1.2.3',
      NODE_ENV: 'production',
      CAREHUB_PUBLIC_URL: 'https://carehub.example.test',
      COOKIE_SECURE: false,
    });
  });

  it('rejects invalid values', () => {
    expect(() => loadConfig({ DATABASE_URL, PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => loadConfig({ DATABASE_URL, PORT: '70000' })).toThrow(/PORT/);
    expect(() => loadConfig({ DATABASE_URL, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ DATABASE_URL, CAREHUB_PUBLIC_URL: 'carehub' })).toThrow(
      /CAREHUB_PUBLIC_URL/,
    );
    expect(() => loadConfig({ DATABASE_URL, COOKIE_SECURE: 'sometimes' })).toThrow(/COOKIE_SECURE/);
  });
});
