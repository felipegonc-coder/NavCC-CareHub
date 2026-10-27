import { describe, expect, it } from 'vitest';
import { parseVttTimestamp, parseWebVtt } from './webvtt';

const vtt = (...lines: string[]) => lines.join('\n');
const problems = (input: string) =>
  parseWebVtt(input).problems.map((p) => `${p.line}: ${p.message}`);

describe('parseVttTimestamp', () => {
  it('reads minutes and hours forms', () => {
    expect(parseVttTimestamp('01:02.500')).toBe(62.5);
    expect(parseVttTimestamp('00:01:02.500')).toBe(62.5);
    expect(parseVttTimestamp('10:00:00.001')).toBe(36000.001);
    expect(parseVttTimestamp('100:00:00.000')).toBe(360000);
  });

  it('refuses anything else', () => {
    for (const bad of ['1:02.500', '00:60.000', '00:01.5', '00:01,500', '1:00:00.000', '', 'abc']) {
      expect(parseVttTimestamp(bad)).toBeNull();
    }
  });
});

describe('parseWebVtt', () => {
  it('reads captions with ids and settings, skipping the header, notes and styles', () => {
    const input = vtt(
      '\uFEFFWEBVTT - Ward tour',
      'Kind: captions',
      '',
      'NOTE This is a note',
      'that spans lines',
      '',
      'STYLE',
      '::cue { color: yellow }',
      '',
      'intro',
      '00:00.000 --> 00:02.500 align:start line:90%',
      '<v Ada>Welcome to the ward.',
      'Second line',
      '',
      '00:03.000-->00:05.000',
      'Next caption',
      '00:06.000 --> 00:01:07.000',
      'No blank line above',
    );
    expect(parseWebVtt(input)).toEqual({
      cues: [
        {
          id: 'intro',
          start: 0,
          end: 2.5,
          settings: 'align:start line:90%',
          text: '<v Ada>Welcome to the ward.\nSecond line',
          line: 11,
        },
        { start: 3, end: 5, text: 'Next caption', line: 15 },
        { start: 6, end: 67, text: 'No blank line above', line: 17 },
      ],
      problems: [],
    });
  });

  it('handles Windows and old Mac line endings', () => {
    const { cues, problems: found } = parseWebVtt(
      'WEBVTT\r\n\r\n00:01.000 --> 00:02.000\r\nOne\r\rtwo\r00:03.000 --> 00:04.000\rTwo',
    );
    expect(found).toEqual([]);
    expect(cues.map((c) => [c.id, c.text, c.line])).toEqual([
      [undefined, 'One', 3],
      ['two', 'Two', 7],
    ]);
  });

  it('needs the WEBVTT first line', () => {
    expect(problems('00:01.000 --> 00:02.000\nHello')).toEqual([
      '1: A captions file has to start with the line "WEBVTT".',
    ]);
    expect(problems('WEBVTTX\n\n00:01.000 --> 00:02.000\nHello')).toHaveLength(1);
    expect(problems('')).toEqual(['1: A captions file has to start with the line "WEBVTT".']);
  });

  it('reports bad times, backwards and out-of-order captions with their line numbers', () => {
    const input = vtt(
      'WEBVTT',
      '',
      '00:01 --> 00:02.000',
      'Bad start',
      '',
      '00:05.000 --> 00:05.000',
      'Ends as it starts',
      '',
      '00:10.000 --> 00:12.000',
      'Fine',
      '',
      '00:08.000 --> 00:09.000',
      'Too early',
    );
    expect(problems(input)).toEqual([
      '3: The time line "00:01 --> 00:02.000" isn\'t valid. Write times as 00:01.000 or 00:00:01.000, with " --> " between them.',
      '6: This caption ends before it starts.',
      '12: Captions have to be in time order, and this one starts before the one above it.',
    ]);
    expect(parseWebVtt(input).cues.map((c) => c.text)).toEqual([
      'Ends as it starts',
      'Fine',
      'Too early',
    ]);
  });

  it("reports text that isn't part of a caption, and files without captions", () => {
    expect(
      problems(vtt('WEBVTT', '', 'Just some text', '', '00:01.000 --> 00:02.000', 'Hi')),
    ).toEqual([
      '3: "Just some text" isn\'t part of a caption. Each caption needs a time line such as "00:01.000 --> 00:04.000" right above its text.',
    ]);
    expect(problems(vtt('WEBVTT', '', 'x'.repeat(80)))[0]).toMatch(
      /^3: "x{57}\.\.\." isn't part of a caption/,
    );
    expect(problems(vtt('WEBVTT', '', 'NOTE nothing else', ''))).toEqual([
      '1: The file has no captions in it.',
    ]);
  });
});
