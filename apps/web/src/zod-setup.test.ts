import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import mainSource from './main.tsx?raw';
import './zod-setup';

describe('zod-setup', () => {
  it("turns off zod's compiled parsers, which the Content-Security-Policy blocks", () => {
    expect(z.config().jitless).toBe(true);
  });

  it('is the first module main.tsx imports, before anything makes a schema', () => {
    expect(mainSource.match(/^import\s.*$/m)?.[0]).toBe("import './zod-setup';");
  });
});
