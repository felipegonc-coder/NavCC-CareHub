import type { BankRow, BankStore } from './store';

// The question bank table in memory, for tests. Fictional data only.

/** A bank store kept in memory, with its rows to look at. */
export type MemoryBankStore = BankStore & { rows: BankRow[] };

/** The question bank table in memory; `now` stamps new rows and saves. */
export function memoryBankStore(now: () => Date = () => new Date()): MemoryBankStore {
  const rows: BankRow[] = [];
  const find = (workspaceId: string, id: string) =>
    rows.find((row) => row.workspaceId === workspaceId && row.id === id);
  return {
    rows,
    async list(workspaceId) {
      return rows
        .filter((row) => row.workspaceId === workspaceId)
        .map(({ id, bank, updatedAt }) => ({
          id,
          title: bank.title,
          description: bank.description ?? null,
          questionCount: bank.questions.length,
          updatedAt,
        }))
        .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
    },
    async get(workspaceId, id) {
      const row = find(workspaceId, id);
      return row && structuredClone(row);
    },
    async getMany(workspaceId, ids) {
      return ids.flatMap((id) => {
        const row = find(workspaceId, id);
        return row ? [structuredClone(row.bank)] : [];
      });
    },
    async insert(row) {
      if (find(row.workspaceId, row.id)) return undefined;
      const at = now();
      const added: BankRow = { ...structuredClone(row), revision: 1, createdAt: at, updatedAt: at };
      rows.push(added);
      return structuredClone(added);
    },
    async update(workspaceId, id, bank, revision) {
      const row = find(workspaceId, id);
      if (!row || row.revision !== revision) return undefined;
      Object.assign(row, { bank: structuredClone(bank), revision: revision + 1, updatedAt: now() });
      return { revision: row.revision };
    },
    async remove(workspaceId, id) {
      const index = rows.findIndex((row) => row.workspaceId === workspaceId && row.id === id);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
  };
}
