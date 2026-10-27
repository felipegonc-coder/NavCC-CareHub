import { describe, expect, it } from 'vitest';
import { fileStorageState, freeShare, overallStatus } from './overall';

const GB = 1024 ** 3;

describe('overallStatus', () => {
  it('is Working when every checked part is fine', () => {
    expect(overallStatus({ server: 'ok', database: 'ok', files: 'ok', jobs: 'ok' })).toBe(
      'working',
    );
    expect(overallStatus({ server: 'ok', database: 'ok', calendar: 'unknown' })).toBe('working');
    expect(overallStatus({})).toBe('working');
  });

  it('is Down when the server or the database is down', () => {
    expect(overallStatus({ server: 'ok', database: 'down', files: 'ok' })).toBe('down');
    expect(overallStatus({ server: 'down', database: 'ok' })).toBe('down');
    expect(overallStatus({ server: 'ok', database: 'down', files: 'problem' })).toBe('down');
  });

  it('is Some problems when another part is down or needs attention', () => {
    expect(overallStatus({ server: 'ok', database: 'ok', collab: 'down' })).toBe('some_problems');
    expect(overallStatus({ server: 'ok', database: 'ok', files: 'problem' })).toBe('some_problems');
    expect(overallStatus({ server: 'ok', database: 'problem' })).toBe('some_problems');
  });
});

describe('fileStorageState', () => {
  it('ST-07: is a problem under 15% free disk space', () => {
    expect(fileStorageState({ writable: true, freeBytes: 50 * GB, totalBytes: 100 * GB })).toBe(
      'ok',
    );
    expect(fileStorageState({ writable: true, freeBytes: 15 * GB, totalBytes: 100 * GB })).toBe(
      'ok',
    );
    expect(fileStorageState({ writable: true, freeBytes: 14 * GB, totalBytes: 100 * GB })).toBe(
      'problem',
    );
  });

  it('is down when files cannot be written or the disk size is unknown', () => {
    expect(fileStorageState({ writable: false, freeBytes: 50 * GB, totalBytes: 100 * GB })).toBe(
      'down',
    );
    expect(fileStorageState({ writable: true, freeBytes: 0, totalBytes: 0 })).toBe('down');
  });
});

describe('freeShare', () => {
  it('is the free part of the disk, from 0 to 1', () => {
    expect(freeShare({ writable: true, freeBytes: 9 * GB, totalBytes: 100 * GB })).toBeCloseTo(
      0.09,
    );
    expect(freeShare({ writable: true, freeBytes: -1, totalBytes: 100 * GB })).toBe(0);
    expect(freeShare({ writable: true, freeBytes: 1, totalBytes: 0 })).toBe(0);
  });
});
