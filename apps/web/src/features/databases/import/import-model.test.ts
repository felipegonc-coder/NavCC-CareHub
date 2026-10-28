import { describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import { jobsDatabase, PROPS, PRIORITY } from '../fixtures';
import {
  checkPickedFile,
  chooseTarget,
  errorMessage,
  errorSheets,
  fileKind,
  importBody,
  readOutcome,
  readPreview,
  readStarted,
  shownColumns,
  undoneCount,
  withTarget,
  type PickedFile,
  type PreviewColumn,
} from './import-model';
import { IMPORT_TEXT } from './import-text';

const MB = 1024 * 1024;
const csv: PickedFile = { name: 'Blue Pine jobs.csv', kind: 'csv', data: 'TmFtZQ==' };
const xlsx: PickedFile = { name: 'Jobs.xlsx', kind: 'xlsx', data: 'UEsDBA==' };

const columns: PreviewColumn[] = [
  {
    index: 0,
    header: 'Name',
    target: { kind: 'existing', propertyId: PROPS.name },
    guessedType: 'text',
  },
  {
    index: 1,
    header: 'Cost',
    target: { kind: 'existing', propertyId: PROPS.cost },
    guessedType: 'number',
  },
  {
    index: 2,
    header: 'Crew',
    target: { kind: 'new', name: 'Crew', type: 'select' },
    guessedType: 'select',
  },
];

describe('picking a file', () => {
  it('takes .csv, .tsv and .xlsx files up to 10 MB', () => {
    expect(fileKind('Blue Pine jobs.CSV')).toBe('csv');
    expect(fileKind('jobs.tsv')).toBe('csv');
    expect(fileKind('Jobs.xlsx')).toBe('xlsx');
    expect(fileKind('Jobs.xls')).toBeNull();
    expect(checkPickedFile({ name: 'jobs.csv', size: 10 * MB })).toBeNull();
    expect(checkPickedFile({ name: 'notes.pdf', size: 10 })).toBe(
      'Choose a .csv, .tsv or .xlsx file.',
    );
    expect(checkPickedFile({ name: 'jobs.csv', size: 10 * MB + 1 })).toBe(
      'This file is larger than 10 MB.',
    );
    expect(checkPickedFile({ name: 'jobs.csv', size: 0 })).toBe('This file is empty.');
  });
});

describe('the requests', () => {
  it('sends the file in the body, with the options that apply to its kind', () => {
    expect(importBody(csv, { firstRowIsHeaders: true, separator: ';', sheet: 'Jobs' })).toEqual({
      fileName: 'Blue Pine jobs.csv',
      data: 'TmFtZQ==',
      firstRowIsHeaders: true,
      separator: ';',
    });
    expect(
      importBody(xlsx, { firstRowIsHeaders: false, separator: ',', sheet: 'Archive' }),
    ).toEqual({
      fileName: 'Jobs.xlsx',
      data: 'UEsDBA==',
      firstRowIsHeaders: false,
      sheet: 'Archive',
    });
  });

  it('sends the columns as the server takes them, without the guessed types', () => {
    const renamed = withTarget(columns, 2, { kind: 'new', name: ' Crew ', type: 'select' });
    expect(importBody(csv, { firstRowIsHeaders: true }, renamed)).toEqual({
      fileName: 'Blue Pine jobs.csv',
      data: 'TmFtZQ==',
      firstRowIsHeaders: true,
      columns: [
        { index: 0, header: 'Name', target: { kind: 'existing', propertyId: PROPS.name } },
        { index: 1, header: 'Cost', target: { kind: 'existing', propertyId: PROPS.cost } },
        { index: 2, header: 'Crew', target: { kind: 'new', name: 'Crew', type: 'select' } },
      ],
    });
  });
});

describe('matching columns', () => {
  const properties = jobsDatabase().properties;

  it('names a new property after its column, with the guessed type, unless the name is taken', () => {
    const plan = chooseTarget(columns, 1, 'new', properties);
    expect(plan[1]?.target).toEqual({ kind: 'new', name: 'Cost 2', type: 'number' });
    expect(chooseTarget(plan, 1, 'skip', properties)[1]?.target).toEqual({ kind: 'skip' });
    expect(chooseTarget(plan, 1, `existing:${PROPS.notes}`, properties)[1]?.target).toEqual({
      kind: 'existing',
      propertyId: PROPS.notes,
    });
  });
});

describe('reading answers', () => {
  const answer = {
    kind: 'csv',
    separator: ';',
    sheets: null,
    sheet: null,
    firstRowIsHeaders: true,
    columns,
    rowCount: 412,
    rows: [
      { rowNumber: 2, title: 'Kitchen sink leak', values: { [PROPS.priority]: 'opt-urgent' } },
    ],
    newProperties: [
      {
        id: 'new-crew',
        name: 'Crew',
        description: '',
        rowPage: 'always',
        config: { type: 'select', options: [] },
      },
    ],
    newOptions: { [PROPS.priority]: [{ id: 'opt-urgent', name: 'Urgent', color: 'red' }] },
    problems: [{ row: 3, column: 'Cost', value: 'about 90', reason: "This isn't a number." }],
    problemCount: 3,
  };

  it('reads a preview, and refuses an answer that isn’t one', () => {
    const preview = readPreview(answer, { kind: 'csv', choices: { firstRowIsHeaders: true } });
    expect(preview).toMatchObject({ separator: ';', rowCount: 412, problemCount: 3 });
    expect(preview?.problems).toHaveLength(1);
    expect(readPreview({}, { kind: 'csv', choices: { firstRowIsHeaders: true } })).toBeNull();
    expect(
      readPreview(
        { ...answer, columns: [{ index: 0, header: 'Name', target: { kind: 'update' } }] },
        { kind: 'csv', choices: { firstRowIsHeaders: true } },
      ),
    ).toBeNull();
  });

  it('shows each filled column with its property, new options and new properties included', () => {
    const preview = readPreview(
      {
        ...answer,
        columns: [
          ...columns,
          {
            index: 3,
            header: 'Priority',
            target: { kind: 'existing', propertyId: PROPS.priority },
            guessedType: 'select',
          },
        ],
      },
      { kind: 'csv', choices: { firstRowIsHeaders: true } },
    );
    if (!preview) throw new Error('No preview');
    const shown = shownColumns(preview, jobsDatabase().properties);
    expect(shown.map((c) => c.property.name)).toEqual(['Name', 'Cost', 'Crew', 'Priority']);
    const priority = shown[3]?.property.config;
    expect(priority?.type === 'select' && priority.options.map((o) => o.id)).toEqual([
      PRIORITY.high,
      PRIORITY.medium,
      PRIORITY.low,
      'opt-urgent',
    ]);
  });

  it('reads the start, the summary and Undo', () => {
    expect(readStarted({ importId: 'import-1', jobId: 'job-import' })).toEqual({
      importId: 'import-1',
      jobId: 'job-import',
    });
    expect(readStarted({ jobId: 'job-import' })).toBeNull();
    expect(readOutcome({ importId: 'import-1', rowCount: 412, problemCount: 3 }).summary).toBe(
      "Imported 412 rows. 3 values couldn't be read.",
    );
    expect(readOutcome({ rowCount: 1, problemCount: 0 }).summary).toBe('Imported 1 row.');
    expect(undoneCount({ importId: 'import-1', rowIds: ['row-1', 'row-2'] }, 412)).toBe(2);
    expect(undoneCount({ ok: true }, 412)).toBe(412);
    expect(IMPORT_TEXT.undone(412)).toBe('Moved 412 rows to Trash.');
  });

  it('shows the server’s words for a refused file, and the sheets it lists', () => {
    const refused = new ApiError(400, 'invalid', "This file couldn't be read.", {
      sheets: [{ name: 'Jobs', hidden: false }],
    });
    expect(errorMessage(refused)).toBe("This file couldn't be read.");
    expect(errorSheets(refused)).toEqual([{ name: 'Jobs', hidden: false }]);
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong. Try again.');
  });
});
