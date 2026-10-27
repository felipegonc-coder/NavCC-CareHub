import type { z } from 'zod';
import type { FillPart, Id, MatchPair, Question, QuestionType, RichText } from '../format/index';
import { LIMITS, QuestionSchema } from '../format/index';
import { cellText, detectSeparator, readCsv } from './csv';

// Spreadsheet (CSV) import for question banks: a header row, then one question per row. Columns, in
// any order: Type | Question | Points | Answer 1 … Answer 10 | Correct | Case sensitive |
// Feedback if right | Feedback if wrong. Cells are read as plain text, never as formulas. Hotspot
// questions need a picture, so they are made in the editor instead.

/** A problem with one spreadsheet row (row 1 is the header row), and the column it's in when there is one. */
export type QuestionCsvError = { row: number; column?: string; message: string };

/** What an import read: the questions that are ready, in sheet order; `rows[i]` is the sheet row of `questions[i]`. */
export type QuestionCsvResult = {
  questions: Question[];
  rows: number[];
  errors: QuestionCsvError[];
};

/** `newId` makes question ids (the server passes format's `newId`). Without it, ids are "row-<sheet row>". */
export type QuestionCsvOptions = { newId?: () => Id };

/** The most text one import reads (about 2 MB). */
export const QUESTION_CSV_MAX_CHARACTERS = 2_000_000;

const ANSWER_COLUMNS = 10;
const MAX_QUESTIONS = LIMITS.bankSnapshotQuestions; // one import fills at most a whole bank
const NAMES = [
  'Type',
  'Question',
  'Points',
  'Correct',
  'Case sensitive',
  'Feedback if right',
  'Feedback if wrong',
] as const;

type Column = (typeof NAMES)[number] | `Answer ${number}`;
type ImportType = Exclude<QuestionType, 'hotspot'>;
type Answer = { n: number; text: string };
type Row = {
  get(column: Column): string;
  /** The non-empty Answer cells; `n` is the Answer column's number. */
  answers: Answer[];
  fail(column: Column | null, message: string): void;
};

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
const answerColumn = (n: number): Column => `Answer ${n}`;
const COLUMNS = new Map<string, Column>(NAMES.map((name) => [squash(name), name]));

/** The column a header names, ignoring case, spaces and punctuation ("Option 2" means Answer 2). */
function columnFor(header: string): Column | null {
  const name = squash(header);
  const answer = /^(?:answer|option)(\d{1,2})$/.exec(name);
  if (!answer) return COLUMNS.get(name) ?? null;
  const n = Number(answer[1]);
  return n >= 1 && n <= ANSWER_COLUMNS ? answerColumn(n) : null;
}

const TYPE_NAMES: Record<ImportType, readonly string[]> = {
  single_choice: ['singlechoice', 'single', 'singleanswer'],
  multiple_choice: ['multiplechoice', 'multiple', 'multipleanswers'],
  true_false: ['truefalse', 'trueorfalse'],
  fill_blank: ['fillintheblank', 'fillintheblanks', 'fillblank'],
  ordering: ['putinorder', 'ordering'],
  matching: ['matching'],
  drag_matching: ['dragmatching', 'draganddropmatching'],
};
const TYPES = new Map<string, ImportType>(
  Object.entries(TYPE_NAMES).flatMap(([type, names]) =>
    names.map((name) => [name, type as ImportType] as const),
  ),
);
const TYPE_LIST =
  'single choice, multiple choice, true/false, fill in the blank, put in order, matching or drag matching';
const YES = new Set(['true', 't', 'yes', 'y']);
const NO = new Set(['false', 'f', 'no', 'n']);

const oneLine = (text: string) => text.replace(/\s+/g, ' ');

/** Rich text from a cell: a blank line starts a new paragraph, other line breaks stay as "\n". */
function richTextFrom(text: string): RichText {
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/);
  return paragraphs
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim() !== '')
    .map((p) => ({ runs: [{ text: p }] }));
}

/** Answer numbers from the Correct cell (1 to 10, or letters A to J), each once; null if a part isn't one. */
function answerNumbers(text: string): number[] | null {
  const tokens = text
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token !== '' && !/^and$/i.test(token));
  const numbers: number[] = [];
  for (const token of tokens) {
    const letter = /^[a-j]$/i.test(token) ? token.toUpperCase().charCodeAt(0) - 64 : 0;
    const n = /^\d{1,2}$/.test(token) ? Number(token) : letter;
    if (n < 1 || n > ANSWER_COLUMNS) return null;
    if (!numbers.includes(n)) numbers.push(n);
  }
  return numbers.length > 0 ? numbers : null;
}

function choiceOptions(row: Row, single: boolean): Record<string, unknown> {
  const { answers } = row;
  if (answers.length < 2)
    row.fail(answerColumn(answers.length + 1), 'Choice questions need at least 2 answers.');
  const extra = answers[LIMITS.options];
  if (extra)
    row.fail(answerColumn(extra.n), `Choice questions can have at most ${LIMITS.options} answers.`);
  const correct = row.get('Correct');
  let right: number[] = [];
  if (correct === '') {
    const which = single
      ? 'the number of the right answer (for example 2)'
      : 'the numbers of the right answers (for example 1, 3)';
    row.fail('Correct', `Write ${which}, or none for a survey question.`);
  } else if (correct.toLowerCase() !== 'none') {
    const numbers = answerNumbers(correct);
    const empty = numbers?.find((n) => !answers.some((answer) => answer.n === n));
    if (numbers === null)
      row.fail(
        'Correct',
        `"${correct}" isn't an answer number. Use the Answer column numbers, for example 2.`,
      );
    else if (empty !== undefined) row.fail('Correct', `Answer ${empty} is empty.`);
    else if (single && numbers.length > 1)
      row.fail('Correct', 'Single choice has one right answer. Use multiple choice for more.');
    else right = numbers;
  }
  const options = answers.map((answer, i) => ({
    id: `a${i + 1}`,
    text: oneLine(answer.text),
    correct: right.includes(answer.n),
  }));
  return { options };
}

/** Parts of a fill-in-the-blank sentence: [answer|other answer] marks a blank; \[ \] \| \\ are literal. */
function blankParts(sentence: string, caseSensitive: boolean): FillPart[] | string {
  const parts: FillPart[] = [];
  let text = '';
  let answers: string[] | null = null;
  let answer = '';
  for (let i = 0; i < sentence.length; i++) {
    let ch = sentence[i] as string;
    const escaped = ch === '\\' && '[]|\\'.includes(sentence[i + 1] ?? 'x');
    if (escaped) ch = sentence[++i] as string;
    if (!escaped && ch === '[') {
      if (answers !== null) return "A blank can't hold another [. Write \\[ for a bracket.";
      if (text !== '') parts.push({ kind: 'text', text });
      text = '';
      answers = [];
      answer = '';
    } else if (!escaped && ch === ']') {
      if (answers === null) return "There's a ] without a [ before it. Write \\] for a bracket.";
      const accepted = [...answers, answer].map((a) => a.trim()).filter((a) => a !== '');
      if (accepted.length === 0)
        return 'Each blank needs an accepted answer, for example [Billing].';
      if (accepted.length > LIMITS.blankAnswers)
        return `A blank can have at most ${LIMITS.blankAnswers} accepted answers.`;
      const id = `b${parts.filter((part) => part.kind === 'blank').length + 1}`;
      parts.push({
        kind: 'blank',
        id,
        answers: accepted,
        ...(caseSensitive ? { caseSensitive } : {}),
      });
      answers = null;
    } else if (!escaped && ch === '|' && answers !== null) {
      answers.push(answer);
      answer = '';
    } else if (answers !== null) answer += ch;
    else text += ch;
  }
  if (answers !== null) return 'A [ is never closed with ].';
  if (text !== '') parts.push({ kind: 'text', text });
  if (!parts.some((part) => part.kind === 'blank'))
    return 'Put each blank in [square brackets], for example: Send it to [Billing].';
  return parts;
}

/** The type-specific fields of a question, or null after reporting why the row can't be read. */
function typeFields(row: Row, type: ImportType): Record<string, unknown> | null {
  const { answers } = row;
  const correct = row.get('Correct');
  const caseText = row.get('Case sensitive').toLowerCase();
  const matchCase = YES.has(caseText);
  if (caseText !== '' && !matchCase && !NO.has(caseText))
    row.fail('Case sensitive', 'Write yes or no.');
  else if (matchCase && type !== 'fill_blank')
    row.fail('Case sensitive', 'Case sensitive is only for fill in the blank questions.');
  const noCorrect = (what: string) => {
    if (correct !== '') row.fail('Correct', `${what} don't use Correct; leave it empty.`);
  };
  switch (type) {
    case 'single_choice':
    case 'multiple_choice':
      return choiceOptions(row, type === 'single_choice');
    case 'true_false': {
      const first = answers[0];
      if (first)
        row.fail(
          answerColumn(first.n),
          "True/false questions don't use the Answer columns. Put true or false in Correct.",
        );
      const value = correct.toLowerCase();
      if (YES.has(value) || NO.has(value)) return { answer: YES.has(value) };
      row.fail(
        'Correct',
        correct === '' ? 'Write true or false.' : `"${correct}" isn't true or false.`,
      );
      return null;
    }
    case 'fill_blank': {
      const sentence = row.get('Answer 1');
      const extra = answers.find((answer) => answer.n !== 1);
      if (extra) row.fail(answerColumn(extra.n), 'Fill in the blank questions use only Answer 1.');
      noCorrect('Fill in the blank questions take their answers from the [brackets], so they');
      if (sentence === '') {
        const moved = row.get('Question').includes('[');
        row.fail(
          'Answer 1',
          moved
            ? 'Move the sentence with the [blanks] here, and keep the instructions in Question.'
            : 'Write the sentence here, with each blank in [square brackets], for example: Send it to [Billing].',
        );
        return null;
      }
      const parts = blankParts(sentence, matchCase);
      if (typeof parts === 'string') row.fail('Answer 1', parts);
      return typeof parts === 'string' ? null : { parts };
    }
    case 'ordering':
      noCorrect('Put-in-order questions list the steps in the right order, so they');
      if (answers.length < 2)
        row.fail(answerColumn(answers.length + 1), 'List at least 2 steps, in the right order.');
      return {
        items: answers.map((answer, i) => ({ id: `i${i + 1}`, text: oneLine(answer.text) })),
      };
    case 'matching':
    case 'drag_matching': {
      noCorrect("Matching questions pair each Answer cell's two sides, so they");
      if (answers.length < 2)
        row.fail(
          answerColumn(answers.length + 1),
          'Give at least 2 pairs, each written as left = right.',
        );
      const extra = answers[LIMITS.pairs];
      if (extra)
        row.fail(
          answerColumn(extra.n),
          `Matching questions can have at most ${LIMITS.pairs} pairs.`,
        );
      const pairs: MatchPair[] = [];
      for (const answer of answers) {
        const at = answer.text.indexOf('=');
        const prompt = oneLine(answer.text.slice(0, Math.max(at, 0))).trim();
        const match = oneLine(answer.text.slice(at + 1)).trim();
        if (at >= 0 && prompt !== '' && match !== '')
          pairs.push({ id: `p${pairs.length + 1}`, prompt, match });
        else
          row.fail(
            answerColumn(answer.n),
            'Write the pair as left = right, for example: Refund = Billing.',
          );
      }
      return { pairs };
    }
  }
}

/** The sheet column a schema problem is about (paths look like ['options', 2, 'text']), or null for the whole row. */
function columnOf(path: readonly PropertyKey[], answers: readonly Answer[]): Column | null {
  const [field, index] = path;
  if (field === 'prompt') return 'Question';
  if (field === 'points') return 'Points';
  if (field === 'feedback')
    return index === 'incorrect' ? 'Feedback if wrong' : 'Feedback if right';
  if (field === 'parts') return 'Answer 1';
  const answer = typeof index === 'number' ? answers[index] : undefined;
  return (field === 'options' || field === 'items' || field === 'pairs') && answer
    ? answerColumn(answer.n)
    : null;
}

function readRow(row: Row & { errors: number }, id: Id): Question | null {
  const typeText = row.get('Type');
  const type = TYPES.get(squash(typeText));
  if (type === undefined) {
    const why = /hot ?spot/i.test(typeText)
      ? 'Hotspot questions need a picture, so add them in the editor.'
      : `"${typeText}" isn't a type that can be imported. Use ${TYPE_LIST}.`;
    row.fail('Type', typeText === '' ? `Write the question type: ${TYPE_LIST}.` : why);
  }
  const prompt = row.get('Question');
  if (prompt === '') row.fail('Question', 'Write the question.');
  const pointsText = row.get('Points');
  const points = pointsText === '' ? 1 : Number(pointsText);
  if (!Number.isInteger(points) || points < 1 || points > LIMITS.questionPoints) {
    row.fail('Points', `Points must be a whole number from 1 to ${LIMITS.questionPoints}.`);
  }
  const right = row.get('Feedback if right');
  const wrong = row.get('Feedback if wrong');
  const fields = type === undefined ? null : typeFields(row, type);
  if (fields === null || row.errors > 0) return null;
  const feedback = {
    ...(right ? { correct: richTextFrom(right) } : {}),
    ...(wrong ? { incorrect: richTextFrom(wrong) } : {}),
  };
  const draft = {
    id,
    type,
    prompt: richTextFrom(prompt),
    points,
    ...(right || wrong ? { feedback } : {}),
    ...fields,
  };
  // The checks above cover the usual mistakes; the format's own limits (text lengths) are the last word.
  const parsed = QuestionSchema.safeParse(draft, { reportInput: true });
  if (parsed.success) return parsed.data;
  const reported = new Set<Column | null>();
  for (const issue of parsed.error.issues) {
    const column = columnOf(issue.path, row.answers);
    if (!reported.has(column)) row.fail(column, schemaMessage(issue));
    reported.add(column);
  }
  return null;
}

/** A plain-language message for a format problem; messages the format writes itself are kept. */
function schemaMessage(issue: z.core.$ZodIssue): string {
  if (issue.code !== 'too_big' || (issue.origin !== 'string' && issue.origin !== 'array'))
    return issue.message;
  const count = (n: number | bigint) => n.toLocaleString('en-US');
  const size =
    typeof issue.input === 'string' || Array.isArray(issue.input) ? issue.input.length : 0;
  const what = issue.origin === 'string' ? 'Must be at most' : 'Can have at most';
  const unit = issue.origin === 'string' ? 'characters' : 'items';
  return `${what} ${count(issue.maximum)} ${unit} (this has ${count(size)}).`;
}

/**
 * Reads questions from spreadsheet text (CSV): a header row, then one question per row. Handles a byte order
 * mark, comma, semicolon or tab separators (picked from the header row), quoted cells and any line endings.
 * Blank rows are skipped. A row with any problem is left out and all its problems are reported, so the import
 * screen can show a row-by-row preview. Reads at most 500 questions. Never throws.
 */
export function parseQuestionCsv(
  text: string,
  options: QuestionCsvOptions = {},
): QuestionCsvResult {
  const result: QuestionCsvResult = { questions: [], rows: [], errors: [] };
  const fail = (row: number, message: string, column?: string) =>
    result.errors.push(column === undefined ? { row, message } : { row, column, message });
  if (text.length > QUESTION_CSV_MAX_CHARACTERS) {
    fail(
      1,
      'This file is too big to import (the limit is about 2 MB). Split it into smaller files.',
    );
    return result;
  }
  const separator = detectSeparator(text, (cell) => columnFor(cellText(cell)) !== null);
  const table = readCsv(text, separator);
  const [header = [], ...records] = table.rows;
  const blank = (cells: readonly string[]) => cells.every((cell) => cellText(cell) === '');
  if (table.unclosedQuoteRow === undefined && table.rows.every(blank)) {
    fail(1, 'The file is empty. Download the template to see the layout.');
    return result;
  }

  const found = new Map<Column, { index: number; name: string }>();
  let clash = false;
  header.forEach((cell, index) => {
    const name = cellText(cell);
    const column = name === '' ? undefined : columnFor(name);
    if (column === null) fail(1, "This column isn't used, so it was skipped.", name);
    else if (column !== undefined && found.has(column)) {
      fail(1, `There are two "${column}" columns. Keep one.`, name);
      clash = true;
    } else if (column !== undefined) found.set(column, { index, name });
  });
  const missing = (['Type', 'Question'] as const).filter((column) => !found.has(column));
  if (missing.length > 0) {
    const names = missing.map((column) => `"${column}"`).join(' and ');
    fail(
      1,
      `The first row needs the column name${missing.length > 1 ? 's' : ''} ${names}. Download the template to see the layout.`,
    );
  }
  if (missing.length > 0 || clash) return finish(result, table.unclosedQuoteRow);

  let read = 0;
  for (const [offset, cells] of records.entries()) {
    const number = offset + 2;
    if (blank(cells)) continue;
    if (read++ === MAX_QUESTIONS) {
      fail(
        number,
        `A bank holds at most ${MAX_QUESTIONS} questions, so this row and the ones after it weren't read.`,
      );
      break;
    }
    const get = (column: Column) => {
      const at = found.get(column);
      return at === undefined ? '' : cellText(cells[at.index]);
    };
    const answers = Array.from({ length: ANSWER_COLUMNS }, (_, i) => ({
      n: i + 1,
      text: get(answerColumn(i + 1)),
    }));
    const row = {
      errors: 0,
      get,
      answers: answers.filter((answer) => answer.text !== ''),
      fail(column: Column | null, message: string) {
        row.errors++;
        fail(number, message, column === null ? undefined : (found.get(column)?.name ?? column));
      },
    };
    if (!blank(cells.slice(header.length))) {
      const name = separator === ',' ? 'comma' : separator === ';' ? 'semicolon' : 'tab';
      row.fail(
        null,
        `This row has more cells than the first row has columns. If a cell holds a ${name}, put it in double quotes.`,
      );
    }
    const question = readRow(row, options.newId ? options.newId() : `row-${number}`);
    if (question) {
      result.questions.push(question);
      result.rows.push(number);
    }
  }
  return finish(result, table.unclosedQuoteRow);
}

function finish(
  result: QuestionCsvResult,
  unclosedQuoteRow: number | undefined,
): QuestionCsvResult {
  if (unclosedQuoteRow !== undefined) {
    const message =
      'A cell starts with a double quote (") that never ends, so this row and the ones after it weren\'t read.';
    result.errors.push({ row: unclosedQuoteRow, message });
  }
  result.errors.sort((a, b) => a.row - b.row);
  return result;
}
