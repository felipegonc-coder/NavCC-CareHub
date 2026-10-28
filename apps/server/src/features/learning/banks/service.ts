import {
  addQuestionsToBank,
  BANK_LIMITS,
  bankIdsUsed,
  checkPublishableWithBanks,
  createQuestionBank,
  newId,
  parseQuestionCsv,
  type BankReply,
  type BankSummary,
  type Course,
  type CreateBankRequest,
  type ImportQuestionsReply,
  type SaveBankRequest,
} from '@carehub/learning';
import { cannotPublish, httpError } from '../errors';
import type { BankRow, BankStore } from './store';

// Question banks (docs/learning/api.md): Studio's bank API with a revision check on save (decision 0304), the
// spreadsheet import, and the publishing step that copies drawn questions into a course. Routes check the
// permission first; every function here stays inside one workspace.

/** Who is acting, and in which workspace. */
export type Actor = { userId: string; workspaceId: string };

const SAVED_MEANWHILE =
  'Someone else saved this bank since you opened it. Reload to see their changes.';
const CHANGED_MEANWHILE = 'This bank changed a moment ago. Try the import again.';
const BANK_FULL = `The bank is full (it holds at most ${BANK_LIMITS.questions} questions), so this row was left out.`;
/** Tries for an import, which reads the bank and saves it with the revision it read. */
const ATTEMPTS = 3;

const replyOf = (row: BankRow): BankReply => ({
  bank: row.bank,
  revision: row.revision,
  updatedAt: row.updatedAt.toISOString(),
});

async function findBank(store: BankStore, workspaceId: string, id: string): Promise<BankRow> {
  const row = await store.get(workspaceId, id);
  if (!row) throw httpError(404);
  return row;
}

/** The workspace's banks in title order, without their questions. */
export async function listBanks(store: BankStore, workspaceId: string): Promise<BankSummary[]> {
  const rows = await store.list(workspaceId);
  return rows.map(({ id, title, description, questionCount, updatedAt }) => ({
    id,
    title,
    ...(description ? { description } : {}),
    questionCount,
    updatedAt: updatedAt.toISOString(),
  }));
}

/** A new, empty bank. */
export async function createBank(
  store: BankStore,
  actor: Actor,
  input: CreateBankRequest,
): Promise<BankReply> {
  const bank = createQuestionBank({
    id: newId(),
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
  });
  const row = await store.insert({
    workspaceId: actor.workspaceId,
    id: bank.id,
    bank,
    createdBy: actor.userId,
  });
  if (!row) throw httpError(409, 'That bank id is taken. Try again.');
  return replyOf(row);
}

/** One bank with the revision to send back when saving it. */
export async function getBank(
  store: BankStore,
  workspaceId: string,
  id: string,
): Promise<BankReply> {
  return replyOf(await findBank(store, workspaceId, id));
}

/** Saves the whole bank unless someone saved since `revision` (409). */
export async function saveBank(
  store: BankStore,
  workspaceId: string,
  id: string,
  input: SaveBankRequest,
): Promise<{ revision: number }> {
  if (input.bank.id !== id) {
    throw httpError(400, undefined, [
      { path: 'bank.id', message: "This doesn't match the bank's address." },
    ]);
  }
  const saved = await store.update(workspaceId, id, input.bank, input.revision);
  if (saved) return saved;
  await findBank(store, workspaceId, id);
  throw httpError(409, SAVED_MEANWHILE);
}

/** Deletes a bank. Live courses keep the questions they copied; drafts that draw from it can't publish. */
export async function deleteBank(store: BankStore, workspaceId: string, id: string): Promise<void> {
  if (!(await store.remove(workspaceId, id))) throw httpError(404);
}

/**
 * Adds the questions from spreadsheet text at the end of the bank. Rows with problems are left out and listed,
 * and so are rows that don't fit in a full bank.
 */
export async function importQuestions(
  store: BankStore,
  workspaceId: string,
  id: string,
  csv: string,
): Promise<ImportQuestionsReply> {
  const read = parseQuestionCsv(csv, { newId });
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const row = await findBank(store, workspaceId, id);
    const { bank, added } = addQuestionsToBank(row.bank, read.questions);
    const leftOut = read.rows
      .slice(added)
      .map((sheetRow) => ({ row: sheetRow, message: BANK_FULL }));
    const errors = [...read.errors, ...leftOut].sort((a, b) => a.row - b.row);
    if (added === 0 || (await store.update(workspaceId, id, bank, row.revision))) {
      return { added, errors };
    }
  }
  throw httpError(409, CHANGED_MEANWHILE);
}

/**
 * The course as it will be published: each bank draw gets a copy of its bank's questions. Throws 422 with
 * every problem (banks named by title) when a bank is gone or too small, or anything else stops publishing.
 */
export async function withBankQuestions(
  store: BankStore,
  workspaceId: string,
  course: Course,
): Promise<Course> {
  const ids = bankIdsUsed(course);
  if (ids.length === 0) return course;
  const banks = await store.getMany(workspaceId, ids);
  const checked = checkPublishableWithBanks(course, banks);
  if (checked.problems.length > 0) throw cannotPublish(checked.problems);
  return checked.course;
}
