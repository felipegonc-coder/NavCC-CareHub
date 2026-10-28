import { xlsxFile } from '@carehub/databases/xlsx/fixtures';
import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobQueryKey, type JobView } from '../../jobs';
import { ApiError } from '../api';
import type { PanelProps } from '../contract';
import {
  databaseWrapper,
  jobsDatabase,
  mockActions,
  mockClient,
  PROPS,
  renderWithDatabase,
  testViewer,
  type MockClient,
} from '../test-utils';
import ImportDialog from './import-dialog';
import { useFollowJob } from './job';
import { forgetImport } from './started';

const CSV = 'Name,Cost,Crew\r\nKitchen sink leak,180,North\r\nWater heater swap,about 90,North\r\n';
const DB = 'db-jobs';

function panelProps(): PanelProps {
  const meta = jobsDatabase();
  const [view] = meta.views;
  if (!view) throw new Error('No view');
  return {
    panel: 'importCsv',
    meta,
    view,
    savedView: view,
    viewer: testViewer(),
    actions: mockActions(),
    canEditViews: true,
    close: vi.fn<() => void>(),
  };
}

const column = (index: number, header: string, target: object, guessedType = 'text') => ({
  index,
  header,
  target,
  guessedType,
});

function csvPreview(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'csv',
    separator: ',',
    sheets: null,
    sheet: null,
    firstRowIsHeaders: true,
    columns: [
      column(0, 'Name', { kind: 'existing', propertyId: PROPS.name }),
      column(1, 'Cost', { kind: 'existing', propertyId: PROPS.cost }, 'number'),
      column(2, 'Crew', { kind: 'new', name: 'Crew', type: 'select' }, 'select'),
    ],
    rowCount: 2,
    rows: [
      {
        rowNumber: 2,
        title: 'Kitchen sink leak',
        values: { [PROPS.cost]: '180', 'new-crew': 'opt-north' },
      },
      { rowNumber: 3, title: 'Water heater swap', values: { 'new-crew': 'opt-north' } },
    ],
    newProperties: [
      {
        id: 'new-crew',
        name: 'Crew',
        description: '',
        rowPage: 'always',
        config: { type: 'select', options: [{ id: 'opt-north', name: 'North', color: 'blue' }] },
      },
    ],
    newOptions: {},
    problems: [{ row: 3, column: 'Cost', value: 'about 90', reason: "This isn't a number." }],
    problemCount: 1,
    ...overrides,
  };
}

function jobView(overrides: Partial<JobView>): JobView {
  return {
    jobId: 'job-import',
    kind: 'databases.csv-import',
    status: 'queued',
    attempts: 0,
    cancelRequested: false,
    progress: null,
    result: null,
    error: null,
    createdAt: '2026-10-27T15:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

// GET /api/jobs/:jobId answers with this job; tests move it on and refetch.
let currentJob: JobView | null = null;

beforeEach(() => {
  currentJob = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const found = String(input) === '/api/jobs/job-import' && currentJob;
      return new Response(
        JSON.stringify(
          found ? { job: found } : { error: { code: 'not_found', message: 'Not found.' } },
        ),
        { status: found ? 200 : 404, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  forgetImport(DB);
});

function setup(client: MockClient = mockClient()) {
  client.previewImport.mockResolvedValue(csvPreview());
  client.startImport.mockResolvedValue({ importId: 'import-1', jobId: 'job-import' });
  const props = panelProps();
  return { ...renderWithDatabase(<ImportDialog {...props} />, { client }), props };
}

function pick(file: File) {
  fireEvent.change(screen.getByLabelText('CSV or Excel file'), { target: { files: [file] } });
}

const csvFile = () => new File([CSV], 'Blue Pine jobs.csv', { type: 'text/csv' });
const lastBody = (client: MockClient) => client.previewImport.mock.calls.at(-1)?.[1];

describe('Import CSV', () => {
  it('previews a small CSV: the matches, the guessed types, the first rows and the problems', async () => {
    const { client } = setup();
    pick(csvFile());
    expect(await screen.findByRole('combobox', { name: 'Name' })).toHaveValue(
      `existing:${PROPS.name}`,
    );
    expect(client.previewImport).toHaveBeenCalledWith(DB, {
      fileName: 'Blue Pine jobs.csv',
      data: btoa(CSV),
      firstRowIsHeaders: true,
    });
    expect(
      screen.getByText('Imports only add rows; they never change existing ones.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Cost' })).toHaveValue(`existing:${PROPS.cost}`);
    expect(screen.getByRole('combobox', { name: 'Crew' })).toHaveValue('new');
    expect(screen.getByRole('textbox', { name: 'Name of the new property for Crew' })).toHaveValue(
      'Crew',
    );
    expect(screen.getByRole('combobox', { name: 'Type of the new property for Crew' })).toHaveValue(
      'select',
    );
    expect(screen.getByRole('combobox', { name: 'Separator' })).toHaveValue(',');
    expect(screen.getByRole('checkbox', { name: 'First row is headers' })).toBeChecked();

    const preview = screen.getByRole('table', { name: 'Preview' });
    expect(within(preview).getByText('Kitchen sink leak')).toBeInTheDocument();
    expect(within(preview).getAllByText('North')).toHaveLength(2);
    expect(screen.getByText('2 rows to import.')).toBeInTheDocument();

    const problems = screen.getByRole('table', { name: 'Problems' });
    expect(screen.getByText("1 value couldn't be read.")).toBeInTheDocument();
    expect(within(problems).getByRole('row', { name: /about 90/ })).toHaveTextContent(
      "3Costabout 90This isn't a number.",
    );
  });

  it('asks again when a match changes, then imports with the plan and shows the progress', async () => {
    const { client, queryClient } = setup();
    pick(csvFile());
    fireEvent.change(await screen.findByRole('combobox', { name: 'Cost' }), {
      target: { value: 'new' },
    });
    await waitFor(() => expect(client.previewImport).toHaveBeenCalledTimes(2));
    const columns = [
      { index: 0, header: 'Name', target: { kind: 'existing', propertyId: PROPS.name } },
      { index: 1, header: 'Cost', target: { kind: 'new', name: 'Cost 2', type: 'number' } },
      { index: 2, header: 'Crew', target: { kind: 'new', name: 'Crew', type: 'select' } },
    ];
    expect(lastBody(client)).toEqual({
      fileName: 'Blue Pine jobs.csv',
      data: btoa(CSV),
      firstRowIsHeaders: true,
      separator: ',',
      columns,
    });

    currentJob = jobView({ status: 'running', progress: { done: 1, total: 2 } });
    const importButton = screen.getByRole('button', { name: 'Import' });
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);
    expect(await screen.findByText('1 of 2 rows')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Import progress' });
    expect(client.startImport).toHaveBeenCalledWith(DB, {
      fileName: 'Blue Pine jobs.csv',
      data: btoa(CSV),
      firstRowIsHeaders: true,
      separator: ',',
      columns,
    });
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '2');
    expect(screen.getByText('Importing Blue Pine jobs.csv…')).toBeInTheDocument();
    expect(
      screen.getByText(
        'You can close this and keep working. Open Import CSV again to see how it went.',
      ),
    ).toBeInTheDocument();

    const refresh = vi.spyOn(queryClient, 'invalidateQueries');
    currentJob = jobView({
      status: 'succeeded',
      progress: { done: 2, total: 2 },
      result: { importId: 'import-1', rowCount: 412, problemCount: 3 },
    });
    await act(() => queryClient.invalidateQueries({ queryKey: jobQueryKey('job-import') }));
    expect(
      await screen.findByText("Imported 412 rows. 3 values couldn't be read."),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download list of problems' })).toHaveAttribute(
      'href',
      `/api/databases/${DB}/imports/import-1/problems`,
    );
    expect(refresh).toHaveBeenCalledWith({ queryKey: ['databases', DB] });
  });

  it('undoes the import from the summary', async () => {
    const { client, queryClient } = setup();
    currentJob = jobView({
      status: 'succeeded',
      result: { importId: 'import-1', rowCount: 412, problemCount: 0 },
    });
    pick(csvFile());
    const importButton = await screen.findByRole('button', { name: 'Import' });
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);
    expect(await screen.findByText('Imported 412 rows.')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Download list of problems' }),
    ).not.toBeInTheDocument();

    const refresh = vi.spyOn(queryClient, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Undo import' }));
    expect(await screen.findByText('Moved 412 rows to Trash.')).toBeInTheDocument();
    expect(client.undoImport).toHaveBeenCalledWith(DB, 'import-1');
    expect(refresh).toHaveBeenCalledWith({ queryKey: ['databases', DB] });
  });

  it('shows why Undo import was refused', async () => {
    const client = mockClient();
    client.undoImport.mockRejectedValue(
      new ApiError(
        409,
        'conflict',
        'Some rows from this import changed since it ran, so nothing was moved to Trash.',
      ),
    );
    setup(client);
    currentJob = jobView({
      status: 'succeeded',
      result: { importId: 'import-1', rowCount: 2, problemCount: 0 },
    });
    pick(csvFile());
    const importButton = await screen.findByRole('button', { name: 'Import' });
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);
    fireEvent.click(await screen.findByRole('button', { name: 'Undo import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Some rows from this import changed since it ran, so nothing was moved to Trash.',
    );
  });

  it('reads the chosen sheet of a small Excel file', async () => {
    const client = mockClient();
    setup(client);
    client.previewImport.mockResolvedValue(
      csvPreview({
        kind: 'xlsx',
        separator: null,
        sheets: [
          { name: 'Jobs', hidden: false },
          { name: 'Archive', hidden: true },
        ],
        sheet: 'Jobs',
      }),
    );
    const bytes = new Uint8Array(
      xlsxFile({
        sheets: [
          { name: 'Jobs', rows: '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' },
          { name: 'Archive', state: 'hidden' },
        ],
        strings: ['Name'],
      }),
    );
    const data = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
    pick(new File([bytes], 'Jobs.xlsx'));
    const sheet = await screen.findByRole('combobox', { name: 'Sheet' });
    expect(client.previewImport).toHaveBeenCalledWith(DB, {
      fileName: 'Jobs.xlsx',
      data,
      firstRowIsHeaders: true,
    });
    expect(sheet).toHaveValue('Jobs');
    expect(within(sheet).getByRole('option', { name: 'Archive (hidden)' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Separator' })).not.toBeInTheDocument();

    fireEvent.change(sheet, { target: { value: 'Archive' } });
    await waitFor(() =>
      expect(lastBody(client)).toEqual({
        fileName: 'Jobs.xlsx',
        data,
        firstRowIsHeaders: true,
        sheet: 'Archive',
      }),
    );
  });

  it('changes the separator and the header row, each with a fresh plan', async () => {
    const client = mockClient();
    setup(client);
    client.previewImport.mockResolvedValue(csvPreview({ separator: ';' }));
    pick(csvFile());
    const separator = await screen.findByRole('combobox', { name: 'Separator' });
    expect(separator).toHaveValue(';');
    expect(
      within(separator)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Comma', 'Semicolon', 'Tab']);

    fireEvent.change(separator, { target: { value: '\t' } });
    await waitFor(() => expect(lastBody(client)).toMatchObject({ separator: '\t' }));
    expect(lastBody(client)).not.toHaveProperty('columns');

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'First row is headers' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'First row is headers' }));
    await waitFor(() => expect(lastBody(client)).toMatchObject({ firstRowIsHeaders: false }));
  });

  it('says what is wrong with the columns before importing', async () => {
    setup();
    pick(csvFile());
    fireEvent.change(await screen.findByRole('combobox', { name: 'Crew' }), {
      target: { value: `existing:${PROPS.name}` },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Only one column can fill "Name".');
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();

    for (const name of ['Name', 'Cost', 'Crew']) {
      fireEvent.change(screen.getByRole('combobox', { name }), { target: { value: 'skip' } });
    }
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose a property or New property for at least one column.',
    );
  });

  it('refuses a file of another kind, an empty one or one over 10 MB before reading it', () => {
    const { client } = setup();
    pick(new File(['%PDF'], 'Invoice.pdf'));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a .csv, .tsv or .xlsx file.');
    pick(new File([], 'Empty.csv'));
    expect(screen.getByRole('alert')).toHaveTextContent('This file is empty.');
    const big = new File(['Name'], 'Big.csv');
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    pick(big);
    expect(screen.getByRole('alert')).toHaveTextContent('This file is larger than 10 MB.');
    expect(client.previewImport).not.toHaveBeenCalled();
  });

  it('shows the server’s words when it can’t read the file', async () => {
    const client = mockClient();
    setup(client);
    client.previewImport.mockRejectedValue(
      new ApiError(400, 'invalid', "This file couldn't be read."),
    );
    pick(csvFile());
    expect(await screen.findByRole('alert')).toHaveTextContent("This file couldn't be read.");
    client.previewImport.mockResolvedValue({});
    pick(csvFile());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again.'),
    );
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('adds no rows when the import fails, and goes back to the columns', async () => {
    setup();
    currentJob = jobView({
      status: 'failed',
      error: "The columns don't fit this database anymore. Check them and try again.",
    });
    pick(csvFile());
    const importButton = await screen.findByRole('button', { name: 'Import' });
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "The columns don't fit this database anymore. Check them and try again.",
    );
    expect(screen.getByText('No rows were added.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('combobox', { name: 'Cost' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
  });

  it('picks a running import back up when it opens again', async () => {
    const client = mockClient();
    const first = setup(client);
    currentJob = jobView({ status: 'queued' });
    pick(csvFile());
    const importButton = await screen.findByRole('button', { name: 'Import' });
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);
    expect(await screen.findByText('Waiting to start…')).toBeInTheDocument();
    first.unmount();

    renderWithDatabase(<ImportDialog {...panelProps()} />, { client });
    expect(await screen.findByRole('progressbar', { name: 'Import progress' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
  });
});

describe('following a job', () => {
  it('stops asking after the limit while the job is unfinished', async () => {
    currentJob = jobView({ status: 'running' });
    const { result } = renderHook(() => useFollowJob('job-import', 300), {
      wrapper: databaseWrapper(),
    });
    await waitFor(() => expect(result.current.job?.status).toBe('running'));
    await waitFor(() => expect(result.current.stopped).toBe(true));
    expect(result.current.job).toBeUndefined();
  });

  it('says why a job can’t be shown', async () => {
    const { result } = renderHook(() => useFollowJob('job-gone'), { wrapper: databaseWrapper() });
    await waitFor(() => expect(result.current.error).toBe('Not found.'));
  });
});
