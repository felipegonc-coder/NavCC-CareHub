import type { QuestionBank } from '@carehub/learning';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { learningBanks as banks } from './schema';

/** A learning_banks row. */
export type BankRow = {
  workspaceId: string;
  id: string;
  bank: QuestionBank;
  revision: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

/** What a new row needs; the revision starts at 1. */
export type NewBankRow = Pick<BankRow, 'workspaceId' | 'id' | 'bank' | 'createdBy'>;

/** One bank in the list: its questions are only counted. */
export type BankListRow = {
  id: string;
  title: string;
  description: string | null;
  questionCount: number;
  updatedAt: Date;
};

/** The question bank table. Every call stays inside one workspace. */
export type BankStore = {
  /** In title order. */
  list(workspaceId: string): Promise<BankListRow[]>;
  get(workspaceId: string, id: string): Promise<BankRow | undefined>;
  /** The banks among `ids` that exist. */
  getMany(workspaceId: string, ids: readonly string[]): Promise<QuestionBank[]>;
  /** Undefined when the workspace already has a bank with that id. */
  insert(row: NewBankRow): Promise<BankRow | undefined>;
  /** Saves `bank` as the next revision, unless the bank is gone or someone saved since `revision`. */
  update(
    workspaceId: string,
    id: string,
    bank: QuestionBank,
    revision: number,
  ): Promise<{ revision: number } | undefined>;
  /** False when there was no such bank. */
  remove(workspaceId: string, id: string): Promise<boolean>;
};

/** The question bank table on Postgres. */
export function bankStore(db: Db | Tx): BankStore {
  const key = (workspaceId: string, id: string) =>
    and(eq(banks.workspaceId, workspaceId), eq(banks.id, id));
  return {
    async list(workspaceId) {
      return db
        .select({
          id: banks.id,
          title: sql<string>`${banks.bank} ->> 'title'`,
          description: sql<string | null>`${banks.bank} ->> 'description'`,
          questionCount: sql<number>`jsonb_array_length(${banks.bank} -> 'questions')`,
          updatedAt: banks.updatedAt,
        })
        .from(banks)
        .where(eq(banks.workspaceId, workspaceId))
        .orderBy(sql`lower(${banks.bank} ->> 'title')`, asc(banks.id));
    },
    async get(workspaceId, id) {
      const [row] = await db.select().from(banks).where(key(workspaceId, id));
      return row;
    },
    async getMany(workspaceId, ids) {
      if (ids.length === 0) return [];
      const rows = await db
        .select({ bank: banks.bank })
        .from(banks)
        .where(and(eq(banks.workspaceId, workspaceId), inArray(banks.id, [...ids])));
      return rows.map((row: { bank: QuestionBank }) => row.bank);
    },
    async insert(row) {
      const [added] = await db.insert(banks).values(row).onConflictDoNothing().returning();
      return added;
    },
    async update(workspaceId, id, bank, revision) {
      const [saved] = await db
        .update(banks)
        .set({ bank, revision: revision + 1, updatedAt: new Date() })
        .where(and(key(workspaceId, id), eq(banks.revision, revision)))
        .returning({ revision: banks.revision });
      return saved;
    },
    async remove(workspaceId, id) {
      const removed = await db
        .delete(banks)
        .where(key(workspaceId, id))
        .returning({ id: banks.id });
      return removed.length > 0;
    },
  };
}
