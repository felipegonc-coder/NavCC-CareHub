import { describe, expect, it } from 'vitest';
import { isJoinable } from './upcoming';
import { upcomingItem } from './testServer';

const at = (iso: string) => new Date(iso);
// Starts at 12:12 PM and ends at 12:42 PM in Denver.
const call = upcomingItem({
  start: '2026-10-27T18:12:00.000Z',
  end: '2026-10-27T18:42:00.000Z',
  videoLink: { url: 'https://zoom.example/j/123', provider: 'zoom' },
});

describe('isJoinable', () => {
  it('turns on 10 minutes before the start and stays on until the end (HR-02)', () => {
    expect(isJoinable(call, at('2026-10-27T18:01:59.999Z'))).toBe(false);
    expect(isJoinable(call, at('2026-10-27T18:02:00.000Z'))).toBe(true);
    expect(isJoinable(call, at('2026-10-27T18:41:59.999Z'))).toBe(true);
    expect(isJoinable(call, at('2026-10-27T18:42:00.000Z'))).toBe(false);
  });

  it('works the same for Google Meet and Microsoft Teams links (HR-17)', () => {
    for (const provider of ['google-meet', 'teams'] as const) {
      const item = { ...call, videoLink: { url: 'https://video.example/abc', provider } };
      expect(isJoinable(item, at('2026-10-27T18:05:00.000Z'))).toBe(true);
    }
  });

  it('needs a video link and a start time', () => {
    expect(isJoinable({ ...call, videoLink: null }, at('2026-10-27T18:20:00.000Z'))).toBe(false);
    const allDay = { ...call, allDay: true, start: '2026-10-27', end: '2026-10-28' };
    expect(isJoinable(allDay, at('2026-10-27T18:20:00.000Z'))).toBe(false);
  });
});
