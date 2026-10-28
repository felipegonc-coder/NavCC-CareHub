// Question banks in the Studio (/learning/studio/banks): the bank list, New bank, the bank editor and the
// spreadsheet import, with fictional banks of the signed-in course builder. The screens get screenshots and the
// axe checks in all four projects; the flows run once, on a computer in light mode.
import { expect, needs, onlyIn, signInAs, test, uniqueName } from '../flows/_support/index.js';
import { checkScreen } from '../support/screen-checks.js';
import {
  BANKS_PATH,
  BUILDER,
  QUESTIONS_CSV,
  bankSaveStatus,
  makeBank,
  questionItem,
  spreadsheet,
} from './banks-data.js';

test.describe('Learning: question bank screens', () => {
  needs('signIn');

  test.beforeEach(async ({ page }) => {
    await signInAs(page, BUILDER);
  });

  test('learning-banks: the bank list', async ({ page }, testInfo) => {
    const bank = await makeBank(page, QUESTIONS_CSV);
    const setup = async () => {
      await page.getByRole('link', { name: bank.title, exact: true }).waitFor();
    };
    await checkScreen(page, { name: 'learning-banks', path: BANKS_PATH, setup }, testInfo);
  });

  test('learning-banks-new-bank: the New bank dialog', async ({ page }, testInfo) => {
    const setup = async () => {
      await page.getByRole('button', { name: 'New bank', exact: true }).click();
      await page.getByRole('dialog', { name: 'New question bank' }).waitFor();
    };
    await checkScreen(page, { name: 'learning-banks-new-bank', path: BANKS_PATH, setup }, testInfo);
  });

  test('learning-banks-editor: a bank with three questions', async ({ page }, testInfo) => {
    const bank = await makeBank(page, QUESTIONS_CSV);
    const setup = async () => {
      await page.getByRole('heading', { level: 3, name: 'Question 3', exact: true }).waitFor();
    };
    await checkScreen(page, { name: 'learning-banks-editor', path: bank.path, setup }, testInfo);
  });

  test('learning-banks-import: the import dialog after a file is read', async ({
    page,
  }, testInfo) => {
    const bank = await makeBank(page);
    const setup = async () => {
      await page.getByRole('button', { name: 'Import from a spreadsheet', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Import questions from a spreadsheet' });
      await dialog.getByLabel('Spreadsheet file').setInputFiles(spreadsheet(QUESTIONS_CSV));
      await dialog.getByText('3 questions ready to add.', { exact: true }).waitFor();
    };
    await checkScreen(page, { name: 'learning-banks-import', path: bank.path, setup }, testInfo);
  });
});

test.describe('Learning: question banks', () => {
  onlyIn('desktop-light');
  needs('signIn');

  test.beforeEach(async ({ page }) => {
    await signInAs(page, BUILDER);
  });

  test('New bank opens the bank, its question is still there after a reload, and Delete bank removes it', async ({
    page,
  }) => {
    await page.goto(BANKS_PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Question banks' })).toBeVisible();
    await page.getByRole('button', { name: 'New bank', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New question bank' });
    const title = uniqueName('Fictional intake bank');
    await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
    await dialog
      .getByRole('textbox', { name: 'Description', exact: true })
      .fill('Fictional questions about the intake form.');
    await dialog.getByRole('button', { name: 'Create bank', exact: true }).click();

    // The new bank opens in the editor, empty.
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    await expect(page).toHaveTitle(`Care Hub · ${title}`);
    const questions = page.getByRole('region', { name: 'Questions', exact: true });
    await expect(questions.getByText('0 of 500', { exact: true })).toBeVisible();

    // A single answer question, saved automatically.
    await questions
      .getByRole('group', { name: 'Add a question' })
      .getByRole('button', { name: 'Single answer', exact: true })
      .click();
    const question = questionItem(page, 1);
    await question
      .getByRole('textbox', { name: 'Question', exact: true })
      .fill('Which fictional form do you open first?');
    await question.getByRole('textbox', { name: 'Answer 1', exact: true }).fill('Intake');
    await question.getByRole('textbox', { name: 'Answer 2', exact: true }).fill('Follow-up');
    await question.getByRole('checkbox', { name: 'Right answer (answer 1)', exact: true }).check();
    await expect(questions.getByText('1 of 500', { exact: true })).toBeVisible();
    await expect(bankSaveStatus(page)).toHaveText('Saved');

    await page.reload();
    const saved = questionItem(page, 1);
    await expect(saved.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue(
      'Which fictional form do you open first?',
    );
    await expect(saved.getByRole('textbox', { name: 'Answer 1', exact: true })).toHaveValue(
      'Intake',
    );
    await expect(saved.getByRole('textbox', { name: 'Answer 2', exact: true })).toHaveValue(
      'Follow-up',
    );
    await expect(
      saved.getByRole('checkbox', { name: 'Right answer (answer 1)', exact: true }),
    ).toBeChecked();

    // The list counts its question; Delete bank, from the editor, takes it off the list.
    const main = page.getByRole('main');
    await main.getByRole('link', { name: 'Question banks', exact: true }).click();
    const row = main
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: title, exact: true }) });
    await expect(row).toContainText('1 question · Edited');
    await row.getByRole('link', { name: title, exact: true }).click();
    await page.getByRole('button', { name: 'Delete bank', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete this bank?' });
    await expect(confirm).toContainText(`This deletes “${title}” and its 1 question.`);
    await confirm.getByRole('button', { name: 'Delete bank', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Question banks' })).toBeVisible();
    await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0);
  });

  test('the spreadsheet import adds the rows that are ready and lists the row it left out', async ({
    page,
  }) => {
    const bank = await makeBank(page);
    await page.goto(bank.path);
    await page.getByRole('button', { name: 'Import from a spreadsheet', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import questions from a spreadsheet' });
    await expect(
      dialog.getByRole('link', { name: 'Download the template', exact: true }),
    ).toHaveAttribute('download', 'question-import-template.csv');

    // The file is read and checked before anything is added.
    await dialog.getByLabel('Spreadsheet file').setInputFiles(spreadsheet(QUESTIONS_CSV));
    await expect(dialog.getByText('3 questions ready to add.', { exact: true })).toBeVisible();
    await expect(
      dialog.getByText('1 row will be left out until fixed:', { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByText(/^Row 5, Correct: /)).toBeVisible();
    await dialog.getByRole('button', { name: 'Add 3 questions', exact: true }).click();

    await expect(dialog).toBeHidden();
    const notice = page
      .getByRole('main')
      .getByRole('status')
      .filter({ hasText: 'Added 3 questions from the spreadsheet, at the end of the bank.' });
    await expect(notice).toContainText('Left out: 1 row.');
    await expect(notice.getByText(/^Row 5, Correct: /)).toBeVisible();
    const questions = page.getByRole('region', { name: 'Questions', exact: true });
    await expect(questions.getByText('3 of 500', { exact: true })).toBeVisible();
    await expect(questions.getByRole('heading', { level: 3 })).toHaveText([
      'Question 1',
      'Question 2',
      'Question 3',
    ]);
    await expect(
      questionItem(page, 1).getByRole('textbox', { name: 'Question', exact: true }),
    ).toHaveValue('Which fictional form do you open first?');
    await expect(
      questionItem(page, 2).getByRole('checkbox', { name: 'Right answer (answer 2)', exact: true }),
    ).toBeChecked();
    await expect(
      questionItem(page, 2).getByRole('checkbox', { name: 'Right answer (answer 3)', exact: true }),
    ).not.toBeChecked();
    await expect(
      questionItem(page, 3).getByRole('checkbox', { name: 'The statement is true', exact: true }),
    ).toBeChecked();

    await notice.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(notice).toBeHidden();
  });
});
