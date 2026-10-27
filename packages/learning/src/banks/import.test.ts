import { describe, expect, it } from 'vitest';
import { QuestionSchema, type Question, type RichText } from '../format/index';
import { parseQuestionCsv, QUESTION_CSV_MAX_CHARACTERS } from './import';

// Fictional content only.
const HEADER = [
  'Type',
  'Question',
  'Points',
  'Answer 1',
  'Answer 2',
  'Answer 3',
  'Answer 4',
  'Correct',
  'Case sensitive',
  'Feedback if right',
  'Feedback if wrong',
];
type Cells = Partial<Record<string, string>>;
const field = (text: string) => (/[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
const sheet = (...rows: Cells[]) =>
  [HEADER, ...rows.map((row) => HEADER.map((name) => row[name] ?? ''))]
    .map((cells) => `${cells.map(field).join(',')}\r\n`)
    .join('');
const one = (row: Cells): Question => {
  const result = parseQuestionCsv(sheet(row));
  expect(result.errors).toEqual([]);
  expect(result.questions).toHaveLength(1);
  return result.questions[0] as Question;
};
const paragraphs = (...texts: string[]): RichText => texts.map((text) => ({ runs: [{ text }] }));
const plainText = (text: RichText) =>
  text.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');
const problems = (row: Cells) =>
  parseQuestionCsv(sheet(row)).errors.map(({ row: n, column, message }) => [n, column, message]);

describe('parseQuestionCsv: question types', () => {
  it('reads single choice, with the right answer by number or letter', () => {
    const row = {
      Type: 'Single choice',
      Question: 'Who handles refunds?',
      'Answer 1': 'Repairs',
      'Answer 2': 'Billing',
      Correct: '2',
    };
    expect(one(row)).toEqual({
      id: 'row-2',
      type: 'single_choice',
      prompt: paragraphs('Who handles refunds?'),
      points: 1,
      options: [
        { id: 'a1', text: 'Repairs', correct: false },
        { id: 'a2', text: 'Billing', correct: true },
      ],
    });
    expect(one({ ...row, Correct: 'b' })).toEqual(one(row));
  });

  it('reads multiple choice with several right answers, and survey questions with none', () => {
    const row = {
      Type: 'multiple choice',
      Question: 'Which are teams?',
      Points: '3',
      'Answer 1': 'Billing',
      'Answer 2': 'Lunch',
      'Answer 3': 'Repairs',
      Correct: '1 and C',
    };
    const question = one(row);
    expect(question.points).toBe(3);
    expect(
      question.type === 'multiple_choice' && question.options.map((option) => option.correct),
    ).toEqual([true, false, true]);
    const survey = one({ ...row, Correct: 'None' });
    expect(
      survey.type === 'multiple_choice' && survey.options.some((option) => option.correct),
    ).toBe(false);
  });

  it('reads true/false from the Correct column', () => {
    expect(one({ Type: 'true/false', Question: 'Refunds take a week.', Correct: 'False' })).toEqual(
      {
        id: 'row-2',
        type: 'true_false',
        prompt: paragraphs('Refunds take a week.'),
        points: 1,
        answer: false,
      },
    );
    expect(
      one({ Type: 'True or false', Question: 'Billing is a team.', Correct: 'yes' }),
    ).toMatchObject({ answer: true });
  });

  it('reads fill in the blank sentences with accepted answers and escapes', () => {
    const question = one({
      Type: 'fill in the blank',
      Question: 'Complete the sentence.',
      'Answer 1': 'Send [refunds|refund requests] to \\[Billing\\] by [Friday].',
      'Case sensitive': 'yes',
    });
    expect(question).toMatchObject({
      type: 'fill_blank',
      parts: [
        { kind: 'text', text: 'Send ' },
        { kind: 'blank', id: 'b1', answers: ['refunds', 'refund requests'], caseSensitive: true },
        { kind: 'text', text: ' to [Billing] by ' },
        { kind: 'blank', id: 'b2', answers: ['Friday'], caseSensitive: true },
        { kind: 'text', text: '.' },
      ],
    });
  });

  it('reads put in order and both kinds of matching', () => {
    const order = one({
      Type: 'put in order',
      Question: 'Order the steps.',
      'Answer 1': 'Greet',
      'Answer 2': 'Check',
      'Answer 3': 'Close',
    });
    expect(order).toMatchObject({
      type: 'ordering',
      items: [
        { id: 'i1', text: 'Greet' },
        { id: 'i2', text: 'Check' },
        { id: 'i3', text: 'Close' },
      ],
    });
    const pairs = {
      Question: 'Match them.',
      'Answer 1': 'Refund = Billing',
      'Answer 2': 'Broken part=Repairs',
    };
    expect(one({ ...pairs, Type: 'matching' })).toMatchObject({
      type: 'matching',
      pairs: [
        { id: 'p1', prompt: 'Refund', match: 'Billing' },
        { id: 'p2', prompt: 'Broken part', match: 'Repairs' },
      ],
    });
    expect(one({ ...pairs, Type: 'Drag matching' }).type).toBe('drag_matching');
  });

  it('turns feedback into rich text, with a blank line starting a new paragraph', () => {
    const question = one({
      Type: 'true/false',
      Question: 'Line one\nline two',
      Correct: 'true',
      'Feedback if right': 'Well done.\n\nKeep going.',
      'Feedback if wrong': 'Not quite.',
    });
    expect(plainText(question.prompt)).toBe('Line one\nline two');
    expect(question.feedback).toEqual({
      correct: paragraphs('Well done.', 'Keep going.'),
      incorrect: paragraphs('Not quite.'),
    });
  });

  it('uses newId for ids when given, and reads cells marked as text', () => {
    let n = 0;
    const result = parseQuestionCsv(
      sheet({ Type: 'true/false', Question: "'=Refunds are free", Correct: 'true' }),
      { newId: () => `id-${++n}` },
    );
    expect(result.questions.map((question) => [question.id, plainText(question.prompt)])).toEqual([
      ['id-1', '=Refunds are free'],
    ]);
  });

  it('makes questions that pass the schema', () => {
    const result = parseQuestionCsv(
      sheet(
        { Type: 'single choice', Question: 'Q1', 'Answer 1': 'A', 'Answer 2': 'B', Correct: '1' },
        { Type: 'fill in the blank', Question: 'Q2', 'Answer 1': 'Ask [Billing]' },
        { Type: 'matching', Question: 'Q3', 'Answer 1': 'a = b', 'Answer 2': 'c = d' },
      ),
    );
    expect(result.rows).toEqual([2, 3, 4]);
    for (const question of result.questions)
      expect(QuestionSchema.safeParse(question).success).toBe(true);
  });
});

describe('parseQuestionCsv: problems', () => {
  it('names the row and column of each problem and leaves those rows out', () => {
    const result = parseQuestionCsv(
      sheet(
        { Type: 'hotspot', Question: 'Click the button.' },
        { Type: 'true/false', Question: 'Fine.', Correct: 'true' },
        { Type: 'essay', Question: 'Write.' },
        {
          Type: 'single choice',
          Question: '',
          'Answer 1': 'A',
          'Answer 2': 'B',
          Correct: '1',
          Points: '0',
        },
      ),
    );
    expect(result.rows).toEqual([3]);
    expect(result.errors.map(({ row, column }) => [row, column])).toEqual([
      [2, 'Type'],
      [4, 'Type'],
      [5, 'Question'],
      [5, 'Points'],
    ]);
    expect(result.errors[0]?.message).toMatch(/need a picture/);
  });

  it('checks choice answers', () => {
    const base = { Type: 'single choice', Question: 'Pick one.', 'Answer 1': 'A', 'Answer 2': 'B' };
    expect(problems(base)).toEqual([
      [
        2,
        'Correct',
        'Write the number of the right answer (for example 2), or none for a survey question.',
      ],
    ]);
    expect(problems({ ...base, Correct: '4' })).toEqual([[2, 'Correct', 'Answer 4 is empty.']]);
    expect(problems({ ...base, Correct: '1, 2' })[0]?.[2]).toMatch(/one right answer/);
    expect(problems({ ...base, Correct: 'first' })[0]?.[2]).toMatch(/isn't an answer number/);
    expect(problems({ ...base, 'Answer 2': '', Correct: '1' })).toEqual([
      [2, 'Answer 2', 'Choice questions need at least 2 answers.'],
    ]);
  });

  it('checks the other types', () => {
    const at = (row: Cells) => problems(row).map(([, column, message]) => [column, message]);
    expect(at({ Type: 'true/false', Question: 'Q', Correct: 'maybe' })).toEqual([
      ['Correct', '"maybe" isn\'t true or false.'],
    ]);
    expect(
      at({ Type: 'true/false', Question: 'Q', Correct: 'true', 'Answer 1': 'x' })[0]?.[0],
    ).toBe('Answer 1');
    expect(
      at({ Type: 'fill in the blank', Question: 'Q', 'Answer 1': 'No blanks here.' })[0]?.[1],
    ).toMatch(/square brackets/);
    expect(at({ Type: 'fill in the blank', Question: 'Q', 'Answer 1': 'Open [blank' })).toEqual([
      ['Answer 1', 'A [ is never closed with ].'],
    ]);
    expect(at({ Type: 'fill in the blank', Question: 'Q [x]' })[0]?.[1]).toMatch(
      /Move the sentence/,
    );
    expect(
      at({ Type: 'put in order', Question: 'Q', 'Answer 1': 'Only one', Correct: '1' }).map(
        ([column]) => column,
      ),
    ).toEqual(['Correct', 'Answer 2']);
    expect(
      at({
        Type: 'matching',
        Question: 'Q',
        'Answer 1': 'Refund = Billing',
        'Answer 2': 'Repairs',
      }),
    ).toEqual([['Answer 2', 'Write the pair as left = right, for example: Refund = Billing.']]);
    expect(
      at({
        Type: 'matching',
        Question: 'Q',
        'Answer 1': 'A = B',
        'Answer 2': 'C = D',
        'Case sensitive': 'yes',
      })[0]?.[0],
    ).toBe('Case sensitive');
  });

  it('reports limits from the question format in the right column', () => {
    const long = 'x'.repeat(501);
    expect(
      problems({
        Type: 'single choice',
        Question: 'Q',
        'Answer 1': 'A',
        'Answer 2': long,
        Correct: '1',
      }),
    ).toEqual([[2, 'Answer 2', 'Must be at most 500 characters (this has 501).']]);
    expect(
      problems({
        Type: 'matching',
        Question: 'Q',
        'Answer 1': `${long} = B`,
        'Answer 2': 'C = D',
      })[0]?.slice(0, 2),
    ).toEqual([2, 'Answer 1']);
    expect(problems({ Type: 'true/false', Question: 'x'.repeat(20_001), Correct: 'true' })).toEqual(
      [[2, 'Question', 'Must be at most 20,000 characters (this has 20,001).']],
    );
    const pairs = Array.from({ length: 9 }, (_, i) => `Team ${i + 1} = Desk ${i + 1}`);
    const columns = pairs.map((_, i) => `Answer ${i + 1}`).join(',');
    expect(
      parseQuestionCsv(`Type,Question,${columns}\nmatching,Q,${pairs.join(',')}\n`).errors,
    ).toEqual([
      { row: 2, column: 'Answer 9', message: 'Matching questions can have at most 8 pairs.' },
    ]);
  });

  it('reports header problems on row 1', () => {
    const unknown = parseQuestionCsv('Type,Question,Correct,Notes\ntrue/false,Q,true,ignored\n');
    expect(unknown.errors).toEqual([
      { row: 1, column: 'Notes', message: "This column isn't used, so it was skipped." },
    ]);
    expect(unknown.questions).toHaveLength(1);
    expect(
      parseQuestionCsv('TYPE;question;Option 1;Option 2;correct\nsingle;Q;A;B;2\n').questions,
    ).toHaveLength(1);
    expect(parseQuestionCsv('Type,Points\nsingle choice,1\n').errors).toEqual([
      {
        row: 1,
        message:
          'The first row needs the column name "Question". Download the template to see the layout.',
      },
    ]);
    expect(parseQuestionCsv('Type,Question,question\n').errors).toEqual([
      { row: 1, column: 'question', message: 'There are two "Question" columns. Keep one.' },
    ]);
  });

  it('skips blank rows and reports extra cells, unclosed quotes, empty and oversized files', () => {
    const rows =
      'Type,Question,Correct\r\n\r\n,,\r\ntrue/false,Q,true,extra\r\ntrue/false,"Q2,true\r\n';
    const result = parseQuestionCsv(rows);
    expect(result.errors.map(({ row }) => row)).toEqual([4, 5]);
    expect(result.errors[0]?.message).toMatch(/more cells than the first row has columns/);
    expect(result.errors[1]?.message).toMatch(/never ends/);
    expect(parseQuestionCsv('\uFEFF\r\n,,\r\n').errors).toEqual([
      { row: 1, message: 'The file is empty. Download the template to see the layout.' },
    ]);
    expect(
      parseQuestionCsv('x'.repeat(QUESTION_CSV_MAX_CHARACTERS + 1)).errors[0]?.message,
    ).toMatch(/too big/);
  });

  it('reads tab-separated sheets and stops after 500 questions', () => {
    const lines = [
      'Type\tQuestion\tCorrect',
      ...Array.from({ length: 501 }, (_, i) => `true/false\tStatement ${i + 1}\ttrue`),
    ];
    const result = parseQuestionCsv(lines.join('\n'));
    expect(result.questions).toHaveLength(500);
    expect(result.errors).toEqual([
      {
        row: 502,
        message:
          "A bank holds at most 500 questions, so this row and the ones after it weren't read.",
      },
    ]);
  });
});
