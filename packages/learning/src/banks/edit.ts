import type { Id, Question } from '../format/index';
import { BANK_LIMITS, type QuestionBank } from './bank';
import { idAllocator } from './internal';

// Editing steps for the Studio bank editor. Each returns a new bank and never changes the one passed in; a step
// that can't happen (an unknown id, a full bank) returns the bank unchanged.

/** Sets the title and description as typed, cut to their limits; an empty description is left out. */
export function setBankDetails(
  bank: QuestionBank,
  details: { title?: string; description?: string },
): QuestionBank {
  const next: QuestionBank = { ...bank };
  if (details.title !== undefined) next.title = details.title.slice(0, BANK_LIMITS.title);
  if (details.description !== undefined) {
    const description = details.description.slice(0, BANK_LIMITS.description);
    if (description) next.description = description;
    else delete next.description;
  }
  return next;
}

const full = (bank: QuestionBank) => bank.questions.length >= BANK_LIMITS.questions;

/** Adds a question at the end, unless the bank already holds 500 (or one with the same id). */
export function addBankQuestion(bank: QuestionBank, question: Question): QuestionBank {
  if (full(bank) || bank.questions.some((existing) => existing.id === question.id)) return bank;
  return { ...bank, questions: [...bank.questions, question] };
}

/** Replaces the question with `id`; the replacement keeps that id. */
export function updateBankQuestion(bank: QuestionBank, id: Id, next: Question): QuestionBank {
  if (!bank.questions.some((question) => question.id === id)) return bank;
  return {
    ...bank,
    questions: bank.questions.map((question) => (question.id === id ? { ...next, id } : question)),
  };
}

/** Copies a question right after itself, with a new id (`q1-2`, …), unless the bank is full. */
export function duplicateBankQuestion(bank: QuestionBank, id: Id): QuestionBank {
  const index = bank.questions.findIndex((question) => question.id === id);
  const original = bank.questions[index];
  if (!original || full(bank)) return bank;
  const allocate = idAllocator(new Set(bank.questions.map((question) => question.id)));
  const copy: Question = {
    ...(JSON.parse(JSON.stringify(original)) as Question),
    id: allocate(id),
  };
  const questions = [...bank.questions];
  questions.splice(index + 1, 0, copy);
  return { ...bank, questions };
}

/** Moves a question so it ends up at `to` (kept inside the list). */
export function moveBankQuestion(bank: QuestionBank, id: Id, to: number): QuestionBank {
  const from = bank.questions.findIndex((question) => question.id === id);
  const target = Math.min(Math.max(Math.trunc(to), 0), bank.questions.length - 1);
  if (from < 0 || from === target) return bank;
  const questions = [...bank.questions];
  const [moved] = questions.splice(from, 1);
  if (moved) questions.splice(target, 0, moved);
  return { ...bank, questions };
}

/** Removes the question with `id`. */
export function removeBankQuestion(bank: QuestionBank, id: Id): QuestionBank {
  const questions = bank.questions.filter((question) => question.id !== id);
  return questions.length === bank.questions.length ? bank : { ...bank, questions };
}
