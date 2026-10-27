/** One caption: its times in seconds, its text (tags kept) and the line its time line is on. */
export type VttCue = {
  id?: string;
  start: number;
  end: number;
  settings?: string;
  text: string;
  line: number;
};
/** A problem in a captions file, in plain language, with its line number (1 = the first line). */
export type VttProblem = { line: number; message: string };

const TIMESTAMP = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/;

/** Seconds for a WebVTT time ("01:02.500" or "00:01:02.500"), or null when it isn't one. */
export function parseVttTimestamp(value: string): number | null {
  const m = TIMESTAMP.exec(value);
  if (!m) return null;
  const [, hours = '0', minutes = '0', seconds = '0', millis = '0'] = m;
  return (
    (Number(hours) * 3_600_000 +
      Number(minutes) * 60_000 +
      Number(seconds) * 1000 +
      Number(millis)) /
    1000
  );
}

const quoteLine = (line: string) => `"${line.length > 60 ? `${line.slice(0, 57)}...` : line}"`;

/**
 * Reads a WebVTT captions file the way browsers do. Captions go in `cues`; anything that would be lost or shown
 * wrongly goes in `problems`: a missing WEBVTT first line, bad times, captions that end before they start or are
 * out of order, and text that isn't part of a caption. Notes, styles and regions are skipped.
 */
export function parseWebVtt(input: string): { cues: VttCue[]; problems: VttProblem[] } {
  const lines = input.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const cues: VttCue[] = [];
  const problems: VttProblem[] = [];
  const problem = (line: number, message: string) => problems.push({ line, message });
  if (!/^WEBVTT([ \t].*)?$/.test(lines[0] ?? '')) {
    problem(1, 'A captions file has to start with the line "WEBVTT".');
    return { cues, problems };
  }
  const blank = (at: number) => (lines[at] ?? '').trim() === '';
  let i = 1;
  while (i < lines.length && !blank(i) && !(lines[i] ?? '').includes('-->')) i++; // header lines
  let lastStart = 0;
  while (i < lines.length) {
    while (i < lines.length && blank(i)) i++;
    if (i >= lines.length) break;
    const first = i;
    const block: string[] = [];
    for (; i < lines.length && !blank(i); i++) {
      const line = lines[i] ?? '';
      // Like browsers, a time line after the first two lines of a block starts the next caption.
      if (line.includes('-->') && (block.length >= 2 || block.some((l) => l.includes('-->'))))
        break;
      block.push(line);
    }
    const head = block[0] ?? '';
    if (/^(NOTE|STYLE|REGION)([ \t]|$)/.test(head)) continue;
    const timingAt = head.includes('-->') ? 0 : 1;
    const timing = block[timingAt];
    const lineNo = first + timingAt + 1;
    if (timing === undefined || !timing.includes('-->')) {
      problem(
        first + 1,
        `${quoteLine(head)} isn't part of a caption. Each caption needs a time line such as "00:01.000 --> 00:04.000" right above its text.`,
      );
      continue;
    }
    const m = /^(\S+?)[ \t]*-->[ \t]*(\S+)(?:[ \t]+(.*))?$/.exec(timing.trim());
    const start = m ? parseVttTimestamp(m[1] ?? '') : null;
    const end = m ? parseVttTimestamp(m[2] ?? '') : null;
    if (start === null || end === null) {
      problem(
        lineNo,
        `The time line ${quoteLine(timing)} isn't valid. Write times as 00:01.000 or 00:00:01.000, with " --> " between them.`,
      );
      continue;
    }
    if (end <= start) problem(lineNo, 'This caption ends before it starts.');
    else if (start < lastStart)
      problem(
        lineNo,
        'Captions have to be in time order, and this one starts before the one above it.',
      );
    lastStart = Math.max(lastStart, start);
    const cue: VttCue = { start, end, text: block.slice(timingAt + 1).join('\n'), line: lineNo };
    if (timingAt === 1) cue.id = head;
    if (m?.[3]?.trim()) cue.settings = m[3].trim();
    cues.push(cue);
  }
  if (cues.length === 0 && problems.length === 0) problem(1, 'The file has no captions in it.');
  return { cues, problems };
}
