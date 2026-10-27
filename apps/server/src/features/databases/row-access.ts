// Row access (decision 0200, "Who can do what"; decision 0007, section 3.3): the row resolver the
// page model asks about every row page. A row gets the best of what reaches it from the database
// and its other parents (ctx.grantLevel, where 'rows_only' passes nothing down), its own sharing
// and the page model's other sources (ctx.inherited), and the database's row access rules. The
// page model applies the role limit afterwards. Template pages have no db_rows entry and keep
// ctx.inherited. Calls made together (a list of rows) share one lookup.
import type { AccessLevel, Property, Row, RowAccessRule } from '@carehub/databases';
import { rowAccess, ruleAccess } from '@carehub/databases/access';
import { sql } from 'drizzle-orm';
import { registerAccessResolver, type RowAccessContext } from '../pages';
import { uuidList, type Executor } from './store';

type Waiting = {
  ctx: RowAccessContext;
  resolve: (level: AccessLevel) => void;
  reject: (error: unknown) => void;
};

type RuleFacts = {
  id: string;
  access_rules: RowAccessRule[] | null;
  properties: Property[] | null;
};
type RowFacts = {
  id: string;
  database_id: string;
  values: Row['values'] | null;
  created_by: string | null;
};

/** The row as the package's rules read it: only values and Created by matter. */
const asRow = (facts: RowFacts): Row => ({
  id: facts.id,
  title: '',
  values: facts.values ?? {},
  createdAt: '',
  createdBy: facts.created_by,
  editedAt: '',
  editedBy: null,
  uniqueNumber: null,
});

/** Each row's level, in the order asked. */
async function levelsFor(db: Executor, asked: readonly RowAccessContext[]): Promise<AccessLevel[]> {
  const databaseIds = [...new Set(asked.map((ctx) => ctx.databasePageId))];
  const { rows: databases } = await db.execute<RuleFacts>(sql`
    SELECT page_id AS id, access_rules, properties FROM db_databases
    WHERE page_id = ANY(${uuidList(databaseIds)}) AND jsonb_array_length(access_rules) > 0`);
  const ruled = new Map(databases.map((d) => [d.id, d]));
  const rowIds = asked.filter((ctx) => ruled.has(ctx.databasePageId)).map((ctx) => ctx.rowPageId);
  const facts = new Map<string, RowFacts>();
  if (rowIds.length > 0) {
    const { rows } = await db.execute<RowFacts>(sql`
      SELECT page_id AS id, database_id, "values", created_by FROM db_rows
      WHERE page_id = ANY(${uuidList(rowIds)})`);
    for (const row of rows) facts.set(row.id, row);
  }
  return asked.map((ctx) => {
    const database = ruled.get(ctx.databasePageId);
    const row = facts.get(ctx.rowPageId);
    if (!database || !row || row.database_id !== ctx.databasePageId) return ctx.inherited;
    const rule = ruleAccess(
      asRow(row),
      database.access_rules ?? [],
      ctx.userId,
      database.properties ?? [],
    );
    return rowAccess({ inherited: ctx.grantLevel, direct: ctx.inherited, rule });
  });
}

const waiting = new Map<Executor, Waiting[]>();

async function settle(db: Executor): Promise<void> {
  const batch = waiting.get(db) ?? [];
  waiting.delete(db);
  try {
    const levels = await levelsFor(
      db,
      batch.map((w) => w.ctx),
    );
    batch.forEach((w, i) => w.resolve(levels[i] ?? w.ctx.inherited));
  } catch (error) {
    for (const w of batch) w.reject(error);
  }
}

/** The page model's row resolver. Rules only add, so Full access needs no lookup. */
export function resolveRowAccess(ctx: RowAccessContext): Promise<AccessLevel> {
  if (ctx.inherited === 'full') return Promise.resolve('full');
  return new Promise((resolve, reject) => {
    const queue = waiting.get(ctx.db);
    if (queue) {
      queue.push({ ctx, resolve, reject });
      return;
    }
    waiting.set(ctx.db, [{ ctx, resolve, reject }]);
    queueMicrotask(() => void settle(ctx.db));
  });
}

/** Registers the row resolver with the page model (again on every app start; the last one counts). */
export function registerRowAccess(): void {
  registerAccessResolver('row', resolveRowAccess);
}
