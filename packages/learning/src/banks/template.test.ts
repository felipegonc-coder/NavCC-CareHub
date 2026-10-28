import { describe, expect, it } from 'vitest';
import { QuestionSchema } from '../format/index';
import { cellText, csvRow, readCsv } from './csv';
import { parseQuestionCsv, QUESTION_CSV_COLUMNS, questionCsvTemplate } from './index';

describe('questionCsvTemplate', () => {
  it('reads back cleanly: one valid question per example row', () => {
    const result = parseQuestionCsv(questionCsvTemplate());
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(result.questions.map((question) => question.type)).toEqual([
      'single_choice',
      'multiple_choice',
      'true_false',
      'fill_blank',
      'ordering',
      'matching',
      'single_choice',
    ]);
    for (const question of result.questions)
      expect(QuestionSchema.safeParse(question).success).toBe(true);
  });

  it('starts with a byte order mark unless asked not to, and can use semicolons', () => {
    expect(questionCsvTemplate().startsWith('\uFEFFType,Question,Points,Answer 1,')).toBe(true);
    const semicolons = questionCsvTemplate({ separator: ';', bom: false });
    expect(semicolons.startsWith('Type;Question;Points;')).toBe(true);
    expect(parseQuestionCsv(semicolons)).toEqual(parseQuestionCsv(questionCsvTemplate()));
  });

  it('has a column guide entry for each column of the header row', () => {
    const header = readCsv(questionCsvTemplate({ bom: false }), ',').rows[0] ?? [];
    const guide = QUESTION_CSV_COLUMNS.map((column) => column.header);
    expect(guide[3]).toBe('Answer 1 … Answer 10');
    expect(header.filter((cell) => !cell.startsWith('Answer '))).toEqual(
      guide.filter((name) => !name.startsWith('Answer ')),
    );
  });
});

describe('csvRow', () => {
  it('quotes cells that need it and ends rows with CRLF', () => {
    expect(csvRow(['plain', 'a,b', 'say "hi"', 'two\nlines', ' edge'], ',')).toBe(
      'plain,"a,b","say ""hi""","two\nlines"," edge"\r\n',
    );
    expect(csvRow(['a;b', 'c,d'], ';')).toBe('"a;b";c,d\r\n');
  });

  it('marks formula-like cells as text, and the import reads them back unchanged', () => {
    const cells = ['=SUM(A1)', '+1', '-2', '@home', 'fine'];
    const line = csvRow(cells, ',');
    expect(line).toBe("'=SUM(A1),'+1,'-2,'@home,fine\r\n");
    expect(readCsv(line, ',').rows[0]?.map(cellText)).toEqual(cells);
  });
});
