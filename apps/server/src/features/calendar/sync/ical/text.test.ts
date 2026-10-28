import { describe, expect, it } from 'vitest';
import {
  escapeText,
  foldLine,
  formatParamValue,
  logicalLines,
  parseContentLine,
  readComponents,
  stripControls,
  unescapeText,
  unfoldBytes,
} from './text';
import type { ContentLine } from './text';

const utf8 = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const lines = (text: string): ContentLine[] =>
  [...logicalLines(text)].map(({ text: raw, line }) => parseContentLine(raw, line)!);

describe('unfoldBytes', () => {
  it('joins folded lines before decoding, so a split emoji survives', () => {
    const cake = utf8('🎂');
    const bytes = Uint8Array.from([
      ...utf8('SUMMARY:Cake tasting '),
      ...cake.subarray(0, 2),
      ...utf8('\r\n '),
      ...cake.subarray(2),
      ...utf8('\r\nUID:1\r\n'),
    ]);
    expect(decode(unfoldBytes(bytes))).toBe('SUMMARY:Cake tasting 🎂\r\nUID:1\r\n');
  });

  it('accepts LF line breaks and tab folds', () => {
    expect(decode(unfoldBytes(utf8('DESCRIPTION:Bring\n\t the tiles\nUID:2')))).toBe(
      'DESCRIPTION:Bring the tiles\nUID:2',
    );
  });
});

describe('logicalLines', () => {
  it('unfolds text and numbers lines from where they start', () => {
    const result = [
      ...logicalLines('BEGIN:VEVENT\r\nSUMMARY:Bluebird\r\n  Bakery\r\n\r\nEND:VEVENT'),
    ];
    expect(result).toEqual([
      { text: 'BEGIN:VEVENT', line: 1 },
      { text: 'SUMMARY:Bluebird Bakery', line: 2 },
      { text: 'END:VEVENT', line: 5 },
    ]);
  });

  it('accepts CR-only line breaks', () => {
    expect([...logicalLines('A:1\rB:2')].map((l) => l.text)).toEqual(['A:1', 'B:2']);
  });
});

describe('parseContentLine', () => {
  it('reads the name, parameters and value', () => {
    const line = parseContentLine(
      'attendee;cn="Ortiz, Sam";PARTSTAT=ACCEPTED;MEMBER="mailto:a@example.com","mailto:b@example.com":mailto:sam.ortiz@example.org',
      3,
    );
    expect(line?.name).toBe('ATTENDEE');
    expect(line?.params.get('CN')).toEqual(['Ortiz, Sam']);
    expect(line?.params.get('PARTSTAT')).toEqual(['ACCEPTED']);
    expect(line?.params.get('MEMBER')).toEqual(['mailto:a@example.com', 'mailto:b@example.com']);
    expect(line?.value).toBe('mailto:sam.ortiz@example.org');
    expect(line?.line).toBe(3);
  });

  it('keeps colons in the value and in quoted parameters', () => {
    const line = parseContentLine('DTSTART;TZID="/example.org/Zone: A":20261102T090000', 1);
    expect(line?.params.get('TZID')).toEqual(['/example.org/Zone: A']);
    expect(line?.value).toBe('20261102T090000');
    expect(parseContentLine('URL:https://example.com/a:b', 1)?.value).toBe(
      'https://example.com/a:b',
    );
  });

  it('decodes RFC 6868 caret escapes', () => {
    const line = parseContentLine('LOCATION;X-ADDRESS="Line one^nLine ^\'two^\' ^^":Shop', 1);
    expect(line?.params.get('X-ADDRESS')).toEqual(['Line one\nLine "two" ^']);
  });

  it('rejects lines without a value or with a bad name', () => {
    expect(parseContentLine('NO VALUE HERE', 1)).toBeUndefined();
    expect(parseContentLine('SUMMARY;CN="unclosed:Lunch', 1)).toBeUndefined();
    expect(parseContentLine('SUM MARY:Lunch', 1)).toBeUndefined();
  });
});

describe('readComponents', () => {
  it('builds the tree and keeps child properties apart', () => {
    const [calendar] = readComponents(
      lines(
        [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'SUMMARY:Tile delivery',
          'BEGIN:VALARM',
          'DESCRIPTION:Reminder',
          'END:VALARM',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n'),
      ),
    );
    expect(calendar?.name).toBe('VCALENDAR');
    const event = calendar?.children[0];
    expect(event?.props.map((p) => p.name)).toEqual(['SUMMARY']);
    expect(event?.children[0]?.props.map((p) => p.value)).toEqual(['Reminder']);
  });

  it('tolerates a missing END and stray END lines', () => {
    const [calendar] = readComponents(
      lines(
        [
          'BEGIN:VCALENDAR',
          'BEGIN:VEVENT',
          'UID:1',
          'BEGIN:VEVENT',
          'UID:2',
          'END:VTODO',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\n'),
      ),
    );
    expect(calendar?.children.map((c) => c.props[0]?.value)).toEqual(['1', '2']);
  });
});

describe('TEXT escaping', () => {
  it('unescapes backslash sequences', () => {
    expect(unescapeText('Tiles\\, grout\\; sealant\\\\done\\nNext\\NLine')).toBe(
      'Tiles, grout; sealant\\done\nNext\nLine',
    );
  });

  it('escapes special characters and drops other controls', () => {
    expect(escapeText('Tiles, grout; sealant\\done\r\nNext\u0007')).toBe(
      'Tiles\\, grout\\; sealant\\\\done\\nNext',
    );
  });

  it('round trips', () => {
    const value = 'Avery, Sam; Riley\\Jordan\nMorgan';
    expect(unescapeText(escapeText(value))).toBe(value);
  });

  it('strips controls, optionally keeping line feeds', () => {
    expect(stripControls('a\tb\nc\u0000d\u007f')).toBe('a\tb\ncd');
    expect(stripControls('a\nb\rc', false)).toBe('abc');
  });

  it('quotes and caret-encodes parameter values', () => {
    expect(formatParamValue('Riley Chen')).toBe('Riley Chen');
    expect(formatParamValue('Ortiz, Sam')).toBe('"Ortiz, Sam"');
    expect(formatParamValue('Say "hi"^\nnow')).toBe("Say ^'hi^'^^^nnow");
  });
});

describe('foldLine', () => {
  it('folds at 75 octets without splitting a character', () => {
    const line = `SUMMARY:${'🎂'.repeat(40)}`;
    const folded = foldLine(line);
    const physical = folded.split('\r\n');
    expect(physical.length).toBeGreaterThan(1);
    for (const part of physical) expect(utf8(part).length).toBeLessThanOrEqual(75);
    expect(physical.slice(1).every((part) => part.startsWith(' '))).toBe(true);
    expect([...logicalLines(folded)][0]?.text).toBe(line);
  });

  it('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:Lunch')).toBe('SUMMARY:Lunch');
    expect(foldLine('X'.repeat(75))).toBe('X'.repeat(75));
    expect(foldLine('X'.repeat(76))).toBe(`${'X'.repeat(75)}\r\n X`);
  });
});

describe('limits (issue #213)', () => {
  it('drops components nested deeper than 8 and reads on after them', () => {
    const names = Array.from({ length: 12 }, (_, i) => `X-LEVEL-${i}`);
    const [calendar] = readComponents(
      lines(
        [
          'BEGIN:VCALENDAR',
          ...names.map((name) => `BEGIN:${name}`),
          'SUMMARY:Too deep',
          ...names.reverse().map((name) => `END:${name}`),
          'BEGIN:VEVENT',
          'UID:after',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n'),
      ),
    );
    let deepest = calendar;
    let depth = 1;
    while (deepest?.children[0]?.name.startsWith('X-LEVEL')) {
      deepest = deepest.children[0];
      depth++;
    }
    expect(depth).toBe(8);
    expect(deepest?.props).toEqual([]);
    expect(calendar?.children.map((c) => c.name)).toEqual(['X-LEVEL-0', 'VEVENT']);
    expect(calendar?.children[1]?.props[0]?.value).toBe('after');
  });

  it('treats a line over the parameter caps as malformed', () => {
    const params = (count: number) => Array.from({ length: count }, (_, i) => `;X-P${i}=1`);
    expect(parseContentLine(`X-NOTE${params(100).join('')}:x`, 1)?.params.size).toBe(100);
    expect(parseContentLine(`X-NOTE${params(101).join('')}:x`, 1)).toBeUndefined();
    const values = (count: number) => Array.from({ length: count }, () => 'a').join(',');
    expect(parseContentLine(`X-NOTE;M=${values(1000)}:x`, 1)?.params.get('M')).toHaveLength(1000);
    expect(parseContentLine(`X-NOTE;M=${values(1001)}:x`, 1)).toBeUndefined();
    expect(parseContentLine(`X-NOTE;M=${values(600)};M=${values(600)}:x`, 1)).toBeUndefined();
  });

  it('adds repeated parameters to the same list, in order', () => {
    const line = parseContentLine(
      'ATTENDEE;MEMBER="mailto:a@example.com";ROLE=CHAIR;MEMBER=b,c:mailto:avery.lin@example.com',
      1,
    );
    expect(line?.params.get('MEMBER')).toEqual(['mailto:a@example.com', 'b', 'c']);
    expect(line?.params.get('ROLE')).toEqual(['CHAIR']);
  });
});
