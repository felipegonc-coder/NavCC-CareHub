import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('uses defaults when nothing is set', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      PORT: 3000,
      HOST: '0.0.0.0',
      CAREHUB_VERSION: '0.0.0-dev',
      NODE_ENV: 'development',
    });
    expect(isAbsolute(config.WEB_DIST_DIR)).toBe(true);
    expect(config.WEB_DIST_DIR.replaceAll('\\', '/')).toMatch(/\/apps\/web\/dist$/);
  });

  it('reads environment values and treats empty ones as unset', () => {
    const config = loadConfig({
      PORT: '8080',
      HOST: '',
      CAREHUB_VERSION: '1.2.3',
      NODE_ENV: 'production',
    });
    expect(config).toMatchObject({
      PORT: 8080,
      HOST: '0.0.0.0',
      CAREHUB_VERSION: '1.2.3',
      NODE_ENV: 'production',
    });
  });

  it('rejects invalid values', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
