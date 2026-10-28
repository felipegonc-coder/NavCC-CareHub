import { LIMITS } from '../format/index';
import { csvRow } from './csv';

// The spreadsheet template for the question import (./import.ts reads it back), and what goes in each column
// for the import screen. The examples are fictional (Harbor Lane Bikes is a made-up shop).

const ANSWER_COLUMNS = 10;

/** The template's columns, in order, with what goes in each one. */
export const QUESTION_CSV_COLUMNS: readonly { header: string; help: string }[] = [
  {
    header: 'Type',
    help: 'single choice, multiple choice, true/false, fill in the blank, put in order, matching or drag matching.',
  },
  {
    header: 'Question',
    help: 'The question. A blank line inside the cell starts a new paragraph.',
  },
  { header: 'Points', help: `1 to ${LIMITS.questionPoints}. Empty means 1.` },
  {
    header: `Answer 1 … Answer ${ANSWER_COLUMNS}`,
    help:
      `Choice questions: one answer per column (2 to ${LIMITS.options}). ` +
      `Put in order: the steps in the right order (2 to ${LIMITS.orderingItems}). ` +
      `Matching: one pair per column, written left = right (2 to ${LIMITS.pairs}). ` +
      'Fill in the blank: Answer 1 holds the sentence, with each blank in [square brackets] and other accepted ' +
      'answers after a |, for example: Press [Hold|the Hold button].',
  },
  {
    header: 'Correct',
    help:
      'Single choice: the number of the right answer, for example 2. Multiple choice: every right number, ' +
      'for example 1, 3. True/false: true or false. Write none for a survey question with no right answer. ' +
      'Empty for the other types.',
  },
  {
    header: 'Case sensitive',
    help: 'Fill in the blank only: yes if capital letters must match. Empty means no.',
  },
  { header: 'Feedback if right', help: 'Optional. Shown after a right answer.' },
  { header: 'Feedback if wrong', help: 'Optional. Shown after a wrong answer.' },
];

type Example = {
  type: string;
  question: string;
  points?: string;
  answers?: string[];
  correct?: string;
  caseSensitive?: string;
  right?: string;
  wrong?: string;
};

const EXAMPLES: readonly Example[] = [
  {
    type: 'single choice',
    question:
      "A Harbor Lane Bikes customer asks for a refund on last week's order. What do you check first?",
    answers: [
      'The order date and the refund policy',
      'The weather forecast',
      'Nothing: refund it straight away',
    ],
    correct: '1',
    right: 'Right: always check the order against the refund policy first.',
    wrong: 'Check the order date against the refund policy before anything else.',
  },
  {
    type: 'multiple choice',
    question: 'Which details can confirm that a caller holds the account? Pick all that apply.',
    points: '2',
    answers: ['The order number', 'The postcode on the account', 'Their favourite colour'],
    correct: '1, 2',
  },
  {
    type: 'true/false',
    question: 'You can promise a delivery date before the warehouse confirms it.',
    correct: 'false',
    wrong: 'Only promise a date once the warehouse has confirmed it.',
  },
  {
    type: 'fill in the blank',
    question: 'Fill in the missing word.',
    answers: ['Damaged items go to the [Returns|Returns team] queue.'],
    caseSensitive: 'no',
  },
  {
    type: 'put in order',
    question: 'Put the steps of a support call in order.',
    points: '2',
    answers: [
      'Greet the caller',
      'Confirm who they are',
      'Solve the problem',
      'Sum up and close the call',
    ],
  },
  {
    type: 'matching',
    question: 'Match each request to the team that handles it.',
    points: '3',
    answers: ['Refund = Billing', 'Broken part = Repairs', 'New address = Accounts'],
  },
  {
    type: 'single choice',
    question: 'How useful was this course?',
    answers: ['Very useful', 'Somewhat useful', 'Not useful'],
    correct: 'none',
  },
];

const HEADER = [
  'Type',
  'Question',
  'Points',
  ...Array.from({ length: ANSWER_COLUMNS }, (_, i) => `Answer ${i + 1}`),
  'Correct',
  'Case sensitive',
  'Feedback if right',
  'Feedback if wrong',
];

const exampleRow = (example: Example): string[] => [
  example.type,
  example.question,
  example.points ?? '1',
  ...Array.from({ length: ANSWER_COLUMNS }, (_, i) => example.answers?.[i] ?? ''),
  example.correct ?? '',
  example.caseSensitive ?? '',
  example.right ?? '',
  example.wrong ?? '',
];

/**
 * The import template: the header row and one example per type, as CSV with CRLF line endings. Comma-separated
 * unless `separator` is ";". Starts with a byte order mark so Excel reads accents, unless `bom` is false.
 */
export function questionCsvTemplate(
  options: { separator?: ',' | ';'; bom?: boolean } = {},
): string {
  const separator = options.separator ?? ',';
  const lines = [HEADER, ...EXAMPLES.map(exampleRow)].map((cells) => csvRow(cells, separator));
  return (options.bom === false ? '' : '\uFEFF') + lines.join('');
}
