// What the assistant tells Claude for one question, and how it reads the answer (Claude features
// spec, section 3.3). The pages are documents the server loaded after the access check.
import { ASSISTANT_TEXTS } from '@carehub/extras/claude/assistant';
import type { ClaudeDocument } from '../index';

/** The chat so far is sent with each question, newest first, up to this much. */
export const HISTORY_CHARS = 8_000;
/** Questions of the chat so far that are sent. */
export const HISTORY_TURNS = 10;
export const HISTORY_TITLE = 'Earlier in this chat';

export const ASSISTANT_SYSTEM = [
  "You are the assistant panel in the person's Care Hub workspace.",
  'Documents titled "Source 1", "Source 2" and so on are pages from the workspace that the person can open.',
  'Answer from those sources only. Never name or link pages that are not among them.',
  `If they don't answer the question, reply with exactly: ${ASSISTANT_TEXTS.notFound}`,
  'After an answer that uses sources, add one last line "Sources: " with the numbers of the sources you used, such as "Sources: 1, 3".',
  'When there are no sources, answer from general knowledge and say so if you are not sure.',
  `The document "${HISTORY_TITLE}" is the conversation so far, for context only.`,
  'Use Markdown: short paragraphs, and lists where they help.',
].join(' ');

/** A question asked before, with its answer when it may be sent again (null when it may not). */
export interface EarlierTurn {
  question: string;
  answer: string | null;
}

/** The chat so far as one document, oldest first, keeping the newest turns that fit. */
export function historyDocument(turns: readonly EarlierTurn[]): ClaudeDocument | null {
  const kept: string[] = [];
  let used = 0;
  for (const turn of [...turns].reverse()) {
    const text = turn.answer
      ? `Question: ${turn.question}\nAnswer: ${turn.answer}`
      : `Question: ${turn.question}\nAnswer: (left out)`;
    if (used + text.length + 2 > HISTORY_CHARS) break;
    kept.unshift(text);
    used += text.length + 2;
  }
  return kept.length === 0 ? null : { title: HISTORY_TITLE, text: kept.join('\n\n') };
}

export const sourceTitle = (n: number, title: string) => `Source ${n}: ${title || 'Untitled'}`;

const SOURCES_LINE =
  /\n?[ \t]*[*_]*Sources?[*_]*:?[*_]*[ \t]*((?:\d+[ \t]*(?:,|and|&)?[ \t]*)+)\.?[ \t]*$/i;
const plain = (text: string) =>
  text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\s.]+$/, '')
    .toLowerCase();

export interface ReadAnswer {
  text: string;
  /** The source numbers Claude named, or null when it named none. */
  cited: number[] | null;
  /** Claude said it couldn't find it. */
  notFound: boolean;
}

/** The answer without its "Sources:" line, the numbers it named (1 to `sources`) and not-found. */
export function readAnswer(answer: string, sources: number): ReadAnswer {
  let text = answer.trim();
  let cited: number[] | null = null;
  const line = SOURCES_LINE.exec(text);
  if (line) {
    text = text.slice(0, line.index).trimEnd();
    const numbers = Array.from(line[1]?.matchAll(/\d+/g) ?? [], (match) => Number(match[0]));
    cited = [...new Set(numbers)].filter((n) => n >= 1 && n <= sources);
  }
  const notFound = plain(text) === plain(ASSISTANT_TEXTS.notFound);
  return { text: notFound ? ASSISTANT_TEXTS.notFound : text, cited, notFound };
}
