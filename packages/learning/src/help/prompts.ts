import { HELP_TONE_LABELS, type HelpTone, type HelpWriteAction } from './api';

// What Learning help asks Claude (decision 0315). The shared client sends the course text as data between
// markers, never as instructions, so nothing here quotes course text.

export type HelpPrompt = { system: string; instruction: string };

/** Said to Claude for every Learning help request, after the shared client's own rules. */
export const HELP_SYSTEM = [
  'You help a trainer write an online course for a Customer Care team in Care Hub Learning.',
  'Write clear, friendly, plain English that a new agent understands.',
  'Use only facts from the course text you are given. Never make up policies, numbers, names or links.',
].join(' ');

const PLAIN =
  'Answer with the new text only, in plain text: no Markdown, HTML or links, and no quotation marks ' +
  'around it. Separate paragraphs with a blank line.';

const WRITE: Readonly<Record<HelpWriteAction, (target: string, tone: HelpTone) => string>> = {
  improve: (target) =>
    `Improve the writing of ${target}: clearer and easier to read, with the same meaning and about the same length.`,
  fix_grammar: (target) =>
    `Fix the spelling, grammar and punctuation of ${target}. Change nothing else.`,
  change_tone: (target, tone) =>
    `Rewrite ${target} in a ${HELP_TONE_LABELS[tone].toLowerCase()} tone, with the same meaning.`,
  shorter: (target) => `Make ${target} shorter, keeping what matters most.`,
  simpler: (target) =>
    `Rewrite ${target} with simpler words and shorter sentences, for someone new to the subject.`,
  continue: () =>
    'Continue the block text from where it ends with one or two short paragraphs that follow on ' +
    'naturally. Do not repeat what is already there.',
};

/** Writing help on a block's text, or on the selected part of it (the block is then context only). */
export function helpWritePrompt(
  action: HelpWriteAction,
  tone: HelpTone | undefined,
  selected: boolean,
): HelpPrompt {
  const target = selected
    ? 'the selection (the block text around it is only there for context)'
    : 'the block text';
  const ask = WRITE[action](target, tone ?? 'professional');
  return { system: HELP_SYSTEM, instruction: `${ask}\n\n${PLAIN}` };
}

/**
 * Claude's plain-text answer, tidied: line endings, a code fence or quotation marks around the whole answer,
 * and runs of blank lines. Empty when nothing is left.
 */
export function helpAnswerText(answer: string): string {
  let text = answer.replace(/\r\n?/g, '\n').trim();
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(text);
  if (fenced) text = (fenced[1] ?? '').trim();
  const quoted = /^["“]([\s\S]*)["”]$/.exec(text);
  if (quoted && !/["“”]/.test(quoted[1] ?? '')) text = (quoted[1] ?? '').trim();
  return text.replace(/\n{3,}/g, '\n\n');
}
