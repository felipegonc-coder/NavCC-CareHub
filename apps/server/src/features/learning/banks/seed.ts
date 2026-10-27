import {
  QUESTION_BANK_FORMAT_VERSION,
  sampleCourses,
  type Question,
  type QuestionBank,
} from '@carehub/learning';
import type { AreaSeed } from '../seed';
import { bankStore } from './store';

/** Titles of the banks the sample courses draw from. Fictional data only. */
const TITLES: Readonly<Record<string, string>> = {
  'bank-escalations': 'Escalation questions',
};

/**
 * The banks the sample courses draw from, holding the questions their published versions copied, so
 * publishing a sample course again from Studio gives it the same questions.
 */
export function sampleBanks(): QuestionBank[] {
  const byBank = new Map<string, Map<string, Question>>();
  for (const course of sampleCourses) {
    for (const lesson of course.lessons) {
      if (lesson.kind !== 'quiz') continue;
      for (const draw of lesson.bankDraws ?? []) {
        const questions = byBank.get(draw.bankId) ?? new Map<string, Question>();
        for (const question of draw.questions ?? []) {
          if (!questions.has(question.id)) questions.set(question.id, question);
        }
        byBank.set(draw.bankId, questions);
      }
    }
  }
  return [...byBank].map(([id, questions]) => ({
    formatVersion: QUESTION_BANK_FORMAT_VERSION,
    id,
    title: TITLES[id] ?? id,
    questions: [...questions.values()],
  }));
}

/** Fictional question banks for the dev and browser-test database, owned by the trainer. Keeps banks already there. */
export const seedBanks: AreaSeed = async (ctx, learning) => {
  const store = bankStore(ctx.db);
  let added = 0;
  for (const bank of sampleBanks()) {
    const row = await store.insert({
      workspaceId: ctx.workspaceId,
      id: bank.id,
      bank,
      createdBy: learning.trainer.id,
    });
    if (row) added += 1;
  }
  ctx.log(`Learning: added ${added} question ${added === 1 ? 'bank' : 'banks'}.`);
};
