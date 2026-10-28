import { describe, expect, it } from 'vitest';
import { nameVersionSchema, restoreNote, saveVersionSchema, versionListQuerySchema } from './index';

describe('the versions API shapes', () => {
  it('trims names, and an empty name removes it', () => {
    expect(nameVersionSchema.parse({ name: '  Before the Nov policy change ' }).name).toBe(
      'Before the Nov policy change',
    );
    expect(nameVersionSchema.parse({ name: '   ' }).name).toBeNull();
    expect(nameVersionSchema.parse({ name: null }).name).toBeNull();
    expect(nameVersionSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
  });

  it('lets the editor ask for versions before Replace all and Accept all only', () => {
    expect(saveVersionSchema.parse({ reason: 'replace' }).reason).toBe('replace');
    expect(saveVersionSchema.safeParse({ reason: 'restore' }).success).toBe(false);
  });

  it('pages 50 at a time by default', () => {
    expect(versionListQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(versionListQuerySchema.safeParse({ before: 'yesterday' }).success).toBe(false);
  });

  it('writes the restore note', () => {
    expect(restoreNote('Avery Lin', 'Oct 20, 3:00 PM')).toBe(
      'Avery Lin restored a version from Oct 20, 3:00 PM.',
    );
  });
});
