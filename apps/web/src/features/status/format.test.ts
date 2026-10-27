import { describe, expect, it } from 'vitest';
import { dayLabel, dayTone, minutesText, sizeText, timeText, uptimeText } from './format';

// Some ICU versions put a narrow no-break space before AM and PM.
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('status page words', () => {
  it('names each day with its uptime, as screen readers read it', () => {
    expect(dayLabel({ date: '2026-10-12', percent: 99.2 })).toBe('October 12: 99.2%');
    expect(dayLabel({ date: '2026-10-13', percent: 100 })).toBe('October 13: 100%');
    expect(dayLabel({ date: '2026-10-14', percent: 99.876 })).toBe('October 14: 99.88%');
    expect(dayLabel({ date: '2026-09-27', percent: null })).toBe('September 27: no data');
  });

  it('colours days green at 99.9% or more, amber at 99% or more, red below', () => {
    expect(dayTone(100)).toBe('good');
    expect(dayTone(99.9)).toBe('good');
    expect(dayTone(99.89)).toBe('fair');
    expect(dayTone(99)).toBe('fair');
    expect(dayTone(98.99)).toBe('poor');
    expect(dayTone(0)).toBe('poor');
    expect(dayTone(null)).toBe('none');
  });

  it('ST-10: shows the 30-day uptime to two decimal places', () => {
    expect(uptimeText(99.9)).toBe('99.90%');
    expect(uptimeText(100)).toBe('100.00%');
    expect(uptimeText(99.896)).toBe('99.90%');
  });

  it("shows times in the viewer's time zone and clock", () => {
    const at = '2026-10-26T08:00:00.000Z';
    expect(plain(timeText(at, { timeZone: 'America/Denver', use24h: false }))).toBe(
      'Oct 26, 2:00 AM',
    );
    expect(plain(timeText(at, { timeZone: 'America/Denver', use24h: true }))).toBe('Oct 26, 02:00');
    expect(plain(timeText(at, { timeZone: 'Europe/Lisbon', use24h: false }))).toBe(
      'Oct 26, 8:00 AM',
    );
  });

  it('shows sizes and lengths in words', () => {
    expect(sizeText(512)).toBe('512 bytes');
    expect(sizeText(1_200_000_000)).toBe('1.2 GB');
    expect(sizeText(40_000_000_000)).toBe('40 GB');
    expect(minutesText(1)).toBe('1 minute');
    expect(minutesText(43)).toBe('43 minutes');
    expect(minutesText(60)).toBe('1 hour');
    expect(minutesText(80)).toBe('1 hour 20 minutes');
    expect(minutesText(125)).toBe('2 hours 5 minutes');
  });
});
