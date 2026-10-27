import { describe, expect, it } from 'vitest';
import type { VersionSummary } from './api';
import {
  restoreQuestion,
  versionDate,
  versionDay,
  versionKindLabel,
  versionLine,
  versionPeople,
} from './format';

const ZONE = 'America/Denver';
const NOW = new Date('2026-10-27T21:30:00Z'); // Tue Oct 27, 3:30 PM in Denver

const version = (fields: Partial<VersionSummary> = {}): VersionSummary => ({
  id: 'v-1',
  kind: 'automatic',
  name: null,
  createdAt: '2026-10-27T21:12:00Z',
  editors: [
    { id: 'u-1', name: 'Avery Lin' },
    { id: 'u-2', name: 'Sam Ortiz' },
  ],
  createdBy: null,
  restoredFrom: null,
  ...fields,
});

describe('version labels', () => {
  it('reads like the spec', () => {
    expect(versionLine(version(), NOW, ZONE)).toBe('Today, 3:12 PM · Avery Lin, Sam Ortiz');
  });

  it('groups by day in the time zone', () => {
    expect(versionDay('2026-10-27T07:00:00Z', NOW, ZONE)).toBe('Today'); // 1 AM
    expect(versionDay('2026-10-27T05:59:00Z', NOW, ZONE)).toBe('Yesterday'); // 11:59 PM
    expect(versionDay('2026-10-20T21:00:00Z', NOW, ZONE)).toBe('Oct 20');
    expect(versionDay('2025-12-31T21:00:00Z', NOW, ZONE)).toBe('Dec 31, 2025');
  });

  it('knows yesterday across a clock change', () => {
    const morning = new Date('2026-03-09T06:30:00Z'); // Mar 9, 12:30 AM, after the change
    expect(versionDay('2026-03-08T07:30:00Z', morning, ZONE)).toBe('Yesterday');
  });

  it('writes the restore question with the version date', () => {
    const from = versionDate('2026-10-20T21:00:00Z', NOW, ZONE);
    expect(from).toBe('Oct 20, 3:00 PM');
    expect(restoreQuestion(from)).toBe(
      'Replace the current page with the version from Oct 20, 3:00 PM? The current page is saved as a version first.',
    );
  });

  it('names whoever caused a version without editors', () => {
    const before = { editors: [], createdBy: { id: 'u-3', name: 'Riley Chen' } };
    expect(versionPeople(version({ kind: 'before_import', ...before }))).toBe('Riley Chen');
    expect(versionPeople(version({ kind: 'before_automation', editors: [] }))).toBe(
      'An automation',
    );
    expect(versionKindLabel('before_replace')).toBe('Before Replace all');
    expect(versionKindLabel('automatic')).toBeNull();
  });
});
