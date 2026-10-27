import { describe, expect, it } from 'vitest';
import { incidentCause, missedMinutes } from './incidents';

describe('missedMinutes', () => {
  it('is the run of minutes between two heartbeats', () => {
    expect(missedMinutes(90, 100)).toEqual({ start: 91, end: 100 });
  });

  it('is null for back-to-back or repeated heartbeats, and for the very first one', () => {
    expect(missedMinutes(99, 100)).toBeNull();
    expect(missedMinutes(100, 100)).toBeNull();
    expect(missedMinutes(null, 100)).toBeNull();
  });
});

describe('incidentCause', () => {
  const previous = { version: '1.4.0', stoppedCleanly: true };

  it('labels a gap that ends as a new version starts "update"', () => {
    expect(incidentCause({ endsAtStart: true, previous, version: '1.5.0' })).toBe('update');
  });

  it('labels a gap after an orderly shutdown of the same version "restart"', () => {
    expect(incidentCause({ endsAtStart: true, previous, version: '1.4.0' })).toBe('restart');
  });

  it('does not know the cause after a crash or power cut', () => {
    const crashed = { version: '1.4.0', stoppedCleanly: false };
    expect(incidentCause({ endsAtStart: true, previous: crashed, version: '1.4.0' })).toBe(
      'unknown',
    );
    expect(incidentCause({ endsAtStart: true, previous: null, version: '1.4.0' })).toBe('unknown');
  });

  it('does not know the cause of a gap while the server kept running (database down)', () => {
    expect(incidentCause({ endsAtStart: false, previous, version: '1.5.0' })).toBe('unknown');
  });
});
