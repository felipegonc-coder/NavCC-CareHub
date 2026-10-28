import type { Locator, Page } from '@playwright/test';
import { apiFor, expect, lanePeople, uniqueName } from '../flows/_support/index.js';

// Fictional question banks for the browser tests of the bank screens and the quiz editor. Each test makes its own
// through the API as the signed-in course builder, then checks them through the screens.

/** The seeded course builder the Studio tests sign in as (Tara Trainer, from the Learning seed). */
export const BUILDER = lanePeople.trainer.email;

/** The bank list's address in the Studio. */
export const BANKS_PATH = '/learning/studio/banks';

/**
 * A spreadsheet with three questions (single answer, multiple answer, true or false) and, in row 5, a question
 * without its right answer, which the import leaves out.
 */
export const QUESTIONS_CSV = [
  'Type,Question,Points,Answer 1,Answer 2,Answer 3,Correct',
  'Single choice,Which fictional form do you open first?,1,Intake,Follow-up,Survey,1',
  'Multiple choice,Which steps come before a fictional transfer?,2,Greet the caller,Check the account,Hang up,"1, 2"',
  'True/false,A fictional hold lasts at most two minutes.,1,,,,true',
  'Single choice,Which fictional queue is the busiest?,1,North,South,,',
].join('\r\n');

/** `csv` as the file someone picks in the import dialog. */
export const spreadsheet = (csv: string) => ({
  name: 'fictional-questions.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(csv, 'utf8'),
});

/** A bank made for one test: its unique title and its address in the Studio. */
export type TestBank = { title: string; path: string };

/**
 * Makes a bank with a unique fictional title as the person signed in on `page`. With `csv`, its questions go in
 * through the spreadsheet import, as Import from a spreadsheet does.
 */
export async function makeBank(page: Page, csv?: string): Promise<TestBank> {
  const api = await apiFor(page);
  const title = uniqueName('Fictional intake bank');
  const { bank } = await api.post<{ bank: { id: string } }>('/api/learning/studio/banks', {
    title,
    description: 'Fictional questions for the browser tests.',
  });
  const id = encodeURIComponent(bank.id);
  if (csv !== undefined) {
    const reply = await api.post<{ added: number }>(`/api/learning/studio/banks/${id}/import`, {
      csv,
    });
    expect(reply.added, 'questions added by the import').toBeGreaterThan(0);
  }
  return { title, path: `${BANKS_PATH}/${id}` };
}

/** The bank editor's save status next to the title: "Saved", "Unsaved changes" or "Saving…". */
export const bankSaveStatus = (page: Page): Locator =>
  page.getByRole('main').getByRole('status').first();

/** Question `n` (from 1) of the list of questions on the screen, found by its "Question n" heading. */
export const questionItem = (page: Page, n: number): Locator =>
  page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 3, name: `Question ${n}`, exact: true }) });
