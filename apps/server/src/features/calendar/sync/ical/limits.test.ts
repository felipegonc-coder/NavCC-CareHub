import { describe, expect, it } from 'vitest';
import { parseCalendar } from './parse';

// Crafted calendars from issue #213, each just under the 10 MB limit. Before the fix, each
// took time that grew with the square of its size (minutes at 1 MB, hours at 10 MB); now each
// takes well under a second locally. The limits leave room for slow CI machines.
const SIZE = 10 * 1024 * 1024 - 4096;
const TEST_TIMEOUT_MS = 30_000;

function fill(make: (i: number) => string): string {
  const parts: string[] = [];
  for (let i = 0, size = 0; size < SIZE; i++) {
    const part = make(i);
    parts.push(part);
    size += part.length;
  }
  return parts.join('');
}

function timed(input: string): { ms: number; warnings: string[]; truncated?: boolean } {
  const start = performance.now();
  const { warnings, truncated } = parseCalendar(input);
  return { ms: performance.now() - start, warnings, truncated };
}

const calendar = (body: string) => `BEGIN:VCALENDAR\r\n${body}END:VCALENDAR\r\n`;

describe('parseCalendar on crafted input (issue #213)', () => {
  it(
    'reads 10 MB of nested BEGIN lines, each with a new name, in seconds',
    () => {
      const input = calendar(fill((i) => `BEGIN:X-${i.toString(36)}\r\n`));
      const { ms, truncated, warnings } = timed(input);
      expect(ms).toBeLessThan(3000);
      // About 750,000 lines: past the 400,000-line limit, so the sync deletes nothing.
      expect(truncated).toBe(true);
      expect(warnings).toContain('The calendar has more than 400000 lines; the rest was left out.');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'reads a 10 MB line that repeats a parameter in seconds',
    () => {
      const input = calendar(`X-NOTE${fill(() => ';A=1')}:x\r\n`);
      const { ms, warnings } = timed(input);
      expect(ms).toBeLessThan(3000);
      expect(warnings).toEqual(["Line 2 isn't a valid iCalendar line and was ignored."]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'reads a 10 MB parameter with endless values in seconds',
    () => {
      const input = calendar(`X-NOTE;A=${fill(() => '1,')}1:x\r\n`);
      expect(timed(input).ms).toBeLessThan(3000);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'reads 10 MB of lines at the parameter cap in seconds',
    () => {
      // About 1.2 million parameters, the most that fits in 10 MB.
      const line = `X-NOTE${Array.from({ length: 100 }, (_, i) => `;P${i}=1,2`).join('')}:x\r\n`;
      const { ms, warnings } = timed(calendar(fill(() => line)));
      expect(ms).toBeLessThan(6000);
      expect(warnings).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
