import { describe, expect, it } from 'vitest';
import { transcriptToPlainText, transcriptToRichText, vttToTranscript } from './transcript';

const vtt = (...lines: string[]) => lines.join('\n');

describe('transcripts', () => {
  const talk = vtt(
    'WEBVTT',
    '',
    '00:00.000 --> 00:02.000',
    '<v Ada Obi>Good morning.</v>',
    '',
    '00:02.000 --> 00:04.000',
    "<v Ada Obi>Let's start the <b>handover</b>.",
    '',
    '00:04.500 --> 00:06.000',
    '<v.loud Ben>Thanks &amp; welcome!',
    '',
    '00:09.000 --> 00:10.000',
    '<v Ben>After a pause.',
  );

  it('joins captions into paragraphs by speaker and pause', () => {
    expect(vttToTranscript(talk)).toEqual([
      { start: 0, speaker: 'Ada Obi', text: "Good morning. Let's start the handover." },
      { start: 4.5, speaker: 'Ben', text: 'Thanks & welcome!' },
      { start: 9, speaker: 'Ben', text: 'After a pause.' },
    ]);
  });

  it('drops lines repeated by rolling captions and cleans tags and entities', () => {
    const rolling = vtt(
      'WEBVTT',
      '',
      '00:00.000 --> 00:01.000',
      'we check the',
      '',
      '00:01.000 --> 00:02.000',
      'we check the',
      'chart every hour',
      '',
      '00:02.000 --> 00:03.000',
      'chart every hour',
      '',
      '00:03.000 --> 00:04.000',
      '<c.yellow>and note</c> <ruby>変化<rt>henka</rt></ruby> &lt;3 &#x2713;&nbsp;&#10003; &bogus;',
    );
    expect(vttToTranscript(rolling)).toEqual([
      { start: 0, text: 'we check the chart every hour and note 変化 <3 ✓ ✓ &bogus;' },
    ]);
  });

  it('starts a new paragraph at a sentence end once a paragraph is long', () => {
    const cues = Array.from({ length: 30 }, (_, i) => ({
      start: i * 3,
      end: i * 3 + 3,
      text: `This is sentence number ${i + 1} of a long talk about safe handovers.`,
      line: i * 3 + 3,
    }));
    const paragraphs = vttToTranscript(cues);
    expect(paragraphs.length).toBeGreaterThan(2);
    for (const p of paragraphs.slice(0, -1)) {
      expect(p.text.length).toBeGreaterThanOrEqual(500);
      expect(p.text.length).toBeLessThan(600);
    }
    expect(paragraphs.map((p) => p.text).join(' ')).toBe(cues.map((c) => c.text).join(' '));
  });

  it('writes the transcript as plain text or rich text with speakers in bold', () => {
    const paragraphs = vttToTranscript(talk);
    expect(transcriptToPlainText(paragraphs)).toBe(
      "Ada Obi: Good morning. Let's start the handover.\n\nBen: Thanks & welcome!\n\nBen: After a pause.",
    );
    expect(transcriptToRichText(paragraphs)).toEqual({
      text: [
        {
          runs: [
            { text: 'Ada Obi: ', marks: ['bold'] },
            { text: "Good morning. Let's start the handover." },
          ],
        },
        { runs: [{ text: 'Ben: ', marks: ['bold'] }, { text: 'Thanks & welcome!' }] },
        { runs: [{ text: 'Ben: ', marks: ['bold'] }, { text: 'After a pause.' }] },
      ],
      truncated: false,
    });
    expect(transcriptToRichText([{ start: 0, text: 'No speaker' }]).text).toEqual([
      { runs: [{ text: 'No speaker' }] },
    ]);
  });

  it('stops before the rich-text limit and says so', () => {
    const paragraphs = vttToTranscript(talk);
    const { text, truncated } = transcriptToRichText(paragraphs, 70);
    expect(truncated).toBe(true);
    expect(text).toHaveLength(2);
  });
});
