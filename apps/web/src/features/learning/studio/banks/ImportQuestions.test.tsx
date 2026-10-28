import { richText } from '@carehub/learning';
import type { QuestionBank } from '@carehub/learning';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportQuestions } from './ImportQuestions';
import { fakeBankApi, renderBanks } from './test-utils';

// Fictional data only.
const desk: QuestionBank = {
  formatVersion: 1,
  id: 'bank-desk',
  title: 'Front desk',
  questions: [
    {
      id: 'q1',
      type: 'true_false',
      prompt: richText('Threats are escalated.'),
      points: 1,
      answer: true,
    },
  ],
};

/** Two questions that are ready and one row with a problem (row 4). */
const SHEET = [
  'Type,Question,Points,Answer 1,Answer 2,Correct',
  'true/false,Callers on hold hear music.,1,,,true',
  'single choice,Which desk takes returns?,1,Front desk,Back office,2',
  'true/false,Refunds take a year.,1,,,maybe',
].join('\r\n');

const csvFile = (content: BlobPart, name = 'questions.csv') =>
  new File([content], name, { type: 'text/csv' });

const posts = (fetch: ReturnType<typeof fakeBankApi>['fetch']) =>
  fetch.mock.calls.filter(([, init]) => init?.method === 'POST');

async function openImport() {
  fireEvent.click(await screen.findByRole('button', { name: 'Import from a spreadsheet' }));
  return screen.getByRole('dialog', { name: 'Import questions from a spreadsheet' });
}

function choose(dialog: HTMLElement, file: File) {
  fireEvent.change(within(dialog).getByLabelText('Spreadsheet file'), {
    target: { files: [file] },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Importing questions into a bank', () => {
  it('offers the template, with a guide to its columns', async () => {
    fakeBankApi([desk]);
    renderBanks('/learning/studio/banks/bank-desk');
    const dialog = await openImport();

    const template = within(dialog).getByRole('link', { name: 'Download the template' });
    expect(template).toHaveAttribute('download', 'question-import-template.csv');
    const text = decodeURIComponent(template.getAttribute('href') ?? '');
    expect(text).toMatch(/^data:text\/csv;charset=utf-8,\uFEFFType,Question,Points,Answer 1,/);
    const semicolons = within(dialog).getByRole('link', { name: 'Template with semicolons' });
    expect(decodeURIComponent(semicolons.getAttribute('href') ?? '')).toContain(
      'Type;Question;Points;Answer 1;',
    );
    expect(within(dialog).getByText('What goes in each column')).toBeInTheDocument();
    expect(within(dialog).getByText('Correct')).toBeInTheDocument();
  });

  it('shows what a file holds before adding anything', async () => {
    const api = fakeBankApi([desk]);
    renderBanks('/learning/studio/banks/bank-desk');
    const dialog = await openImport();
    expect(within(dialog).getByRole('button', { name: 'Add questions' })).toBeDisabled();

    choose(dialog, csvFile(SHEET));

    expect(await within(dialog).findByText('2 questions ready to add.')).toBeInTheDocument();
    expect(within(dialog).getByText('1 row will be left out until fixed:')).toBeInTheDocument();
    expect(within(dialog).getByText(/^Row 4, Correct: /)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add 2 questions' })).toBeEnabled();
    expect(posts(api.fetch)).toHaveLength(0);
  });

  it('saves waiting changes first, then adds the questions and lists the rows left out', async () => {
    const api = fakeBankApi([desk]);
    renderBanks('/learning/studio/banks/bank-desk');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Description' }), {
      target: { value: 'Questions for the front desk.' },
    });
    const dialog = await openImport();
    choose(dialog, csvFile(SHEET));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Add 2 questions' }));

    expect(
      await screen.findByText('Added 2 questions from the spreadsheet, at the end of the bank.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/^Row 4, Correct: /)).toBeInTheDocument();
    expect(screen.getByText('3 of 500')).toBeInTheDocument();
    const methods = api.fetch.mock.calls.map(([, init]) => init?.method ?? 'GET');
    expect(methods.indexOf('PUT')).toBeGreaterThan(-1);
    expect(methods.indexOf('PUT')).toBeLessThan(methods.indexOf('POST'));
    expect(posts(api.fetch)[0]?.[0]).toBe('/api/learning/studio/banks/bank-desk/import');
    const stored = api.banks.get('bank-desk');
    expect(stored?.bank.description).toBe('Questions for the front desk.');
    expect(stored?.bank.questions.map((question) => question.id)).toEqual([
      'q1',
      'imported-1',
      'imported-2',
    ]);

    // The editor carries on from the bank as imported.
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Front desk basics' },
    });
    await waitFor(() => expect(api.saves()).toHaveLength(2), { timeout: 3000 });
    expect(api.saves()[1]?.revision).toBe(stored?.revision);
    expect(api.saves()[1]?.bank.questions).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/^Added 2 questions/)).not.toBeInTheDocument();
  });

  it("doesn't import into a bank without a title", async () => {
    const api = fakeBankApi([desk]);
    renderBanks('/learning/studio/banks/bank-desk');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Title' }), {
      target: { value: ' ' },
    });
    const dialog = await openImport();
    choose(dialog, csvFile(SHEET));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Add 2 questions' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Give the bank a title first, so your changes are saved.',
    );
    expect(posts(api.fetch)).toHaveLength(0);
  });

  it("says why when the server doesn't take the import", async () => {
    const api = fakeBankApi([desk]);
    renderBanks('/learning/studio/banks/bank-desk');
    const dialog = await openImport();
    choose(dialog, csvFile(SHEET));
    const add = await within(dialog).findByRole('button', { name: 'Add 2 questions' });
    api.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'conflict',
            message: 'This bank changed a moment ago. Try the import again.',
          },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    fireEvent.click(add);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "The questions couldn't be imported. This bank changed a moment ago. Try the import again.",
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(api.banks.get('bank-desk')?.bank.questions).toHaveLength(1);
  });
});

describe('The import preview', () => {
  function renderImport(questionCount: number) {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ImportQuestions
          bankId="bank-desk"
          questionCount={questionCount}
          beforeImport={async () => null}
          onImported={vi.fn()}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import from a spreadsheet' }));
    return screen.getByRole('dialog');
  }

  it('adds only what fits in the bank', async () => {
    const dialog = renderImport(499);
    choose(dialog, csvFile(SHEET));
    expect(
      await within(dialog).findByText(
        'The bank has room for 1 more question, so only the first one will be added.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add 1 question' })).toBeEnabled();
  });

  it("can't add to a full bank", async () => {
    const dialog = renderImport(500);
    choose(dialog, csvFile(SHEET));
    expect(await within(dialog).findByText(/^The bank is full/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add questions' })).toBeDisabled();
  });

  it('says when a file has no questions it can read', async () => {
    const dialog = renderImport(0);
    choose(dialog, csvFile('Name,Email\r\nAvery Stone,avery@example.com\r\n', 'people.csv'));
    expect(await within(dialog).findByText('No questions are ready to add.')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Row 1: The first row needs the column names "Type" and "Question". Download the template to see the layout.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add questions' })).toBeDisabled();
  });

  it("warns when characters couldn't be read", async () => {
    const dialog = renderImport(0);
    // "Café" from an older spreadsheet encoding: é is the single byte 0xE9, which isn't UTF-8.
    const encode = (text: string) => [...new TextEncoder().encode(text)];
    const bytes = new Uint8Array([
      ...encode('Type,Question,Correct\r\ntrue/false,The caf'),
      0xe9,
      ...encode(' opens at 9.,true\r\n'),
    ]);
    choose(dialog, csvFile(bytes));
    expect(await within(dialog).findByText(/Some characters couldn.t be read/)).toBeInTheDocument();
    expect(within(dialog).getByText('1 question ready to add.')).toBeInTheDocument();
  });
});
