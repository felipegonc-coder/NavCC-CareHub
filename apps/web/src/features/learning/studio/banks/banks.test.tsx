import { richText } from '@carehub/learning';
import type { QuestionBank } from '@carehub/learning';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBankApi, renderBanks } from './test-utils';

// Fictional data only.
const escalations: QuestionBank = {
  formatVersion: 1,
  id: 'bank-escalations',
  title: 'Escalation questions',
  description: 'When to hand a call to a team lead.',
  questions: [
    {
      id: 'q1',
      type: 'true_false',
      prompt: richText('Angry callers go to a lead.'),
      points: 1,
      answer: false,
    },
    {
      id: 'q2',
      type: 'true_false',
      prompt: richText('Threats are escalated.'),
      points: 1,
      answer: true,
    },
  ],
};
const empty: QuestionBank = {
  formatVersion: 1,
  id: 'bank-returns',
  title: 'Returns desk',
  questions: [],
};

const location = () => screen.getByTestId('location');
/** Waits for the autosave (a short pause after the last change). */
const saved = () =>
  waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument(), { timeout: 3000 });

/** Signs in a fictional person whose profile is in `timeZone`; every other call goes to the bank fake. */
function withProfileZone(api: ReturnType<typeof fakeBankApi>, timeZone: string) {
  const bankApi = api.fetch.getMockImplementation();
  if (!bankApi) throw new Error('fakeBankApi answers fetch.');
  api.fetch.mockImplementation(async (input, init) =>
    String(input) === '/api/auth/me'
      ? new Response(JSON.stringify({ user: { id: 'user-kai', name: 'Kai Example', timeZone } }), {
          headers: { 'Content-Type': 'application/json' },
        })
      : bankApi(input, init),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('Question bank list', () => {
  it('lists the banks with their question counts, and links to each', async () => {
    fakeBankApi([escalations, empty]);
    renderBanks('/learning/studio/banks');
    const link = await screen.findByRole('link', { name: 'Escalation questions' });
    expect(link).toHaveAttribute('href', '/learning/studio/banks/bank-escalations');
    expect(screen.getByText('When to hand a call to a team lead.')).toBeInTheDocument();
    expect(screen.getByText(/^2 questions · Edited/)).toBeInTheDocument();
    expect(screen.getByText(/^0 questions · Edited/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Question banks');
  });

  it("shows the day a bank was edited in the person's time zone", async () => {
    withProfileZone(fakeBankApi([escalations]), 'Pacific/Honolulu');
    renderBanks('/learning/studio/banks');
    // The fake's banks were edited at 09:00 UTC on 20 October, which is still the 19th in Honolulu.
    const edited = new Date('2026-10-20T09:00:00.000Z');
    const day = (timeZone: string) =>
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone }).format(edited);
    expect(day('Pacific/Honolulu')).not.toBe(day('America/Denver'));
    expect(
      await screen.findByText(`2 questions · Edited ${day('Pacific/Honolulu')}`),
    ).toBeInTheDocument();
  });

  it('says how to start when there are no banks', async () => {
    fakeBankApi();
    renderBanks('/learning/studio/banks');
    expect(
      await screen.findByText('No question banks yet. Start one with New bank.'),
    ).toBeInTheDocument();
  });

  it('starts a bank from a title and opens it in the editor', async () => {
    const api = fakeBankApi();
    renderBanks('/learning/studio/banks');
    fireEvent.click(screen.getByRole('button', { name: 'New bank' }));
    const dialog = screen.getByRole('dialog', { name: 'New question bank' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create bank' }));
    expect(within(dialog).getByText('Give the bank a title.')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), {
      target: { value: '  Fire safety  ' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Description' }), {
      target: { value: 'Alarms and exits.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create bank' }));
    await waitFor(() => expect(location()).toHaveTextContent('/learning/studio/banks/bank-1'));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Fire safety' }),
    ).toBeInTheDocument();
    const posted = api.fetch.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(posted?.[1]?.body))).toEqual({
      title: 'Fire safety',
      description: 'Alarms and exits.',
    });
  });

  it('shows people without Studio access a plain message', () => {
    fakeBankApi([escalations]);
    renderBanks('/learning/studio/banks', { canBuild: false });
    expect(screen.getByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
  });
});

describe('Question bank editor', () => {
  it('saves changes to the details and questions, each save on the last revision', async () => {
    const api = fakeBankApi([escalations]);
    renderBanks('/learning/studio/banks/bank-escalations');
    const title = await screen.findByRole('textbox', { name: 'Title' });
    expect(screen.getByText('2 of 500')).toBeInTheDocument();
    fireEvent.change(title, { target: { value: 'Escalations' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await saved();
    expect(api.saves()).toEqual([{ bank: { ...escalations, title: 'Escalations' }, revision: 1 }]);

    fireEvent.click(screen.getByRole('button', { name: 'True or false' }));
    expect(screen.getByText('3 of 500')).toBeInTheDocument();
    await waitFor(() => expect(api.saves()).toHaveLength(2), { timeout: 3000 });
    expect(api.saves()[1]?.revision).toBe(2);
    expect(api.saves()[1]?.bank.questions).toHaveLength(3);
    expect(api.banks.get('bank-escalations')?.revision).toBe(3);
  });

  it('copies, moves and removes questions', async () => {
    const api = fakeBankApi([escalations]);
    renderBanks('/learning/studio/banks/bank-escalations');
    fireEvent.click(await screen.findByRole('button', { name: 'Copy question 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move question 3 up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove question 1' }));
    await saved();
    const ids = api.banks.get('bank-escalations')?.bank.questions.map((question) => question.id);
    expect(ids).toEqual(['q2', 'q1-2']);
  });

  it("doesn't save a bank without a title", async () => {
    const api = fakeBankApi([escalations]);
    renderBanks('/learning/studio/banks/bank-escalations');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Title' }), {
      target: { value: ' ' },
    });
    expect(screen.getByText('Give the bank a title.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Not saved: the bank needs a title.');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(api.saves()).toEqual([]);
  });

  it('never overwrites a save by someone else, and reloads their version', async () => {
    const api = fakeBankApi([escalations]);
    renderBanks('/learning/studio/banks/bank-escalations');
    const title = await screen.findByRole('textbox', { name: 'Title' });
    api.banks.set('bank-escalations', {
      bank: { ...escalations, title: 'Their title' },
      revision: 2,
      updatedAt: '2026-10-27T10:00:00.000Z',
    });
    fireEvent.change(title, { target: { value: 'My title' } });
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert).toHaveTextContent('Someone else saved this bank since you opened it');
    expect(api.banks.get('bank-escalations')?.bank.title).toBe('Their title');

    fireEvent.click(within(alert).getByRole('button', { name: 'Reload' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Their title'),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('deletes the bank after asking, then goes back to the list', async () => {
    const api = fakeBankApi([escalations, empty]);
    renderBanks('/learning/studio/banks/bank-escalations');
    fireEvent.click(await screen.findByRole('button', { name: 'Delete bank' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this bank?' });
    expect(dialog).toHaveTextContent('This deletes “Escalation questions” and its 2 questions.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete bank' }));
    await waitFor(() => expect(location()).toHaveTextContent(/^\/learning\/studio\/banks$/));
    expect(api.banks.has('bank-escalations')).toBe(false);
    expect(await screen.findByRole('link', { name: 'Returns desk' })).toBeInTheDocument();
  });

  it('says so when the bank is gone', async () => {
    fakeBankApi();
    renderBanks('/learning/studio/banks/bank-gone');
    expect(await screen.findByText('This was deleted, or the link is wrong.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});
