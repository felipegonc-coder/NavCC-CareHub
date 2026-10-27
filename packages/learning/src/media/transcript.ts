import { LIMITS, type RichText } from '../format/index';
import { parseWebVtt, type VttCue } from './webvtt';

/** One paragraph of a transcript: who speaks (from the captions' voice tags) and what they say. */
export type TranscriptParagraph = { start: number; speaker?: string; text: string };

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  lrm: '',
  rlm: '',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** A caption's speaker (from `<v Name>`) and its text lines without tags. */
function cueLines(raw: string): { speaker?: string; lines: string[] } {
  const speaker = /<v(?:\.[^\s>]*)*[ \t]+([^>]+)>/.exec(raw)?.[1]?.trim();
  const text = raw.replace(/<rt>[\s\S]*?<\/rt>/g, '').replace(/<[^>]*>/g, '');
  const lines = text
    .split('\n')
    .map((line) => decodeEntities(line).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return speaker ? { speaker: decodeEntities(speaker), lines } : { lines };
}

/**
 * Turns captions into a readable transcript: tags removed, lines joined, lines repeated by rolling captions
 * dropped, and a new paragraph when the speaker changes, after a pause of 2 seconds or more, or at the end of a
 * sentence once a paragraph is long.
 */
export function vttToTranscript(captions: string | readonly VttCue[]): TranscriptParagraph[] {
  const cues = typeof captions === 'string' ? parseWebVtt(captions).cues : captions;
  const paragraphs: TranscriptParagraph[] = [];
  let current: TranscriptParagraph | undefined;
  let lastLine = '';
  let lastEnd = 0;
  for (const cue of cues) {
    const { speaker, lines } = cueLines(cue.text);
    const fresh = lines.filter((line) => line !== lastLine);
    lastLine = lines[lines.length - 1] ?? lastLine;
    if (fresh.length === 0) continue;
    const text = fresh.join(' ');
    const breakHere =
      !current ||
      (speaker !== undefined && speaker !== current.speaker) ||
      cue.start - lastEnd >= 2 ||
      (current.text.length >= 500 && /[.!?…]["')\]]?$/.test(current.text));
    if (breakHere) {
      current = speaker ? { start: cue.start, speaker, text } : { start: cue.start, text };
      paragraphs.push(current);
    } else if (current) {
      current.text = `${current.text} ${text}`;
    }
    lastEnd = cue.end;
  }
  return paragraphs;
}

/** The transcript as plain text: one paragraph per block, speakers as "Name: ". */
export function transcriptToPlainText(paragraphs: readonly TranscriptParagraph[]): string {
  return paragraphs.map((p) => (p.speaker ? `${p.speaker}: ${p.text}` : p.text)).join('\n\n');
}

/**
 * The transcript as rich text for a video or audio block, speakers in bold. Stops before `maxCharacters`
 * (the rich-text limit) and says whether anything was left out.
 */
export function transcriptToRichText(
  paragraphs: readonly TranscriptParagraph[],
  maxCharacters: number = LIMITS.richText,
): { text: RichText; truncated: boolean } {
  const text: RichText = [];
  let used = 0;
  for (const p of paragraphs) {
    const label = p.speaker ? `${p.speaker}: ` : '';
    const size = label.length + p.text.length;
    if (used + size > maxCharacters || text.length >= LIMITS.paragraphs)
      return { text, truncated: true };
    text.push({
      runs: label ? [{ text: label, marks: ['bold'] }, { text: p.text }] : [{ text: p.text }],
    });
    used += size;
  }
  return { text, truncated: false };
}
