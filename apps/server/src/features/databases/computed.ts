// Formula and rollup results on the server (W2-3), for the view engine's `computed`: worked out for
// one viewer within the formula limits (one time budget per request, the formula engine's step,
// item and text limits, and the same item and text limits on rollups), reading related rows only
// from the request's row cache and only the properties the viewer can see there.
import {
  LIMITS,
  type ComputedValue,
  type ConfigOf,
  type Id,
  type Property,
  type Row,
  type Viewer,
} from '@carehub/databases';
import { QUERY_TOO_SLOW, type ComputeContext, type QueryBudget } from '@carehub/databases/engine';
import {
  EMPTY,
  REQUEST_FORMULA_MS,
  ROW_TEXT_LIMIT,
  TOO_COMPLEX,
  TOO_MUCH_TEXT,
  basicSchema,
  compileFormula,
  fail,
  type CompileResult,
  type FormulaBudget,
  type FormulaContext,
  type FormulaSchema,
} from '@carehub/databases/formula';
import { computeRollup, guardLoops, type RollupSource } from '@carehub/databases/rollup';
import type { PeopleBook } from './people';
import type { RowCache } from './row-cache';
import { linkIds, type DatabaseSchema, type Schemas } from './view-access';

/** Items a result may hold, counting the items of lists inside it (as the formula engine). */
export const NESTED_ITEMS = 10 * LIMITS.formulaListItems;

/** One request's time for formulas and rollups, shared by the view engine and the formula engine. */
export interface RequestBudget extends QueryBudget, FormulaBudget {
  deadline: number;
}

/** A budget of `ms` milliseconds from now on `clock`. */
export function requestBudget(
  clock: () => number = () => performance.now(),
  ms: number = REQUEST_FORMULA_MS,
): RequestBudget {
  return { clock, deadline: clock() + ms };
}

/**
 * A rollup result within the formula limits: at most NESTED_ITEMS items counting nested lists
 * ("This formula is too complex.") and ROW_TEXT_LIMIT characters ("This formula makes too much
 * text."). Formulas are held to these by the formula engine as they run.
 */
export function withinLimits(value: ComputedValue): ComputedValue {
  let items = 0;
  let chars = 0;
  const problem = (v: ComputedValue): string | null => {
    if (v.kind === 'text') {
      chars += v.value.length;
      return chars > ROW_TEXT_LIMIT ? TOO_MUCH_TEXT : null;
    }
    if (v.kind !== 'list') return null;
    items += v.value.length;
    if (items > NESTED_ITEMS) return TOO_COMPLEX;
    for (const item of v.value) {
      const found = problem(item);
      if (found) return found;
    }
    return null;
  };
  const message = problem(value);
  return message ? { kind: 'error', message } : value;
}

export interface ComputerInput {
  schemas: Schemas;
  cache: RowCache;
  viewer: Viewer;
  people: PeopleBook;
  budget: RequestBudget;
}

/** What the view engine is given for formulas, rollups and related titles. */
export interface Computer {
  computed(row: Row, propertyId: Id, ctx: ComputeContext): ComputedValue;
  /** Title of a row in another database the viewer can open. */
  rowTitle(id: Id): string | undefined;
  /** Some result said "⚠ Too slow" (time ran out, or the rows it needed weren't loaded). */
  readonly timedOut: boolean;
}

/** The contexts of one engine run: its own database's, and one per related database. */
interface World {
  engine: ComputeContext;
  home: FormulaContext;
  /** What every context of the run shares. */
  shared: Omit<FormulaContext, 'properties' | 'computed'>;
  related: Map<Id, FormulaContext>;
  /** Results for related rows, remembered for the run and guarded against loops. */
  elsewhere(row: Row, propertyId: Id): ComputedValue;
}

const isComputed = (p: Property): boolean =>
  p.config.type === 'formula' || p.config.type === 'rollup';

/** Formula and rollup results for one viewer, reading related rows from the request's cache. */
export function makeComputer(input: ComputerInput): Computer {
  const { schemas, cache, viewer, people, budget } = input;
  const homeId = schemas.home.id;
  let slow = false;
  const tooSlow = (): ComputedValue => {
    slow = true;
    return { kind: 'error', message: QUERY_TOO_SLOW };
  };

  // Formulas are compiled once per request against their database's whole schema, remembered by
  // database and property.
  const formulaSchemas = new Map<Id, FormulaSchema | null>();
  const schemaOf = (databaseId: Id): FormulaSchema | null => {
    if (formulaSchemas.has(databaseId)) return formulaSchemas.get(databaseId) ?? null;
    const db = schemas.byId.get(databaseId);
    const schema = db
      ? basicSchema(db.properties, (relationId) => {
          const rel = db.properties.find((p) => p.id === relationId);
          return rel?.config.type === 'relation' ? schemaOf(rel.config.targetDatabaseId) : null;
        })
      : null;
    formulaSchemas.set(databaseId, schema);
    return schema;
  };
  const compiled = new Map<string, CompileResult>();
  const compiledFor = (prop: Property<ConfigOf<'formula'>>, databaseId: Id): CompileResult => {
    const key = `${databaseId}:${prop.id}`;
    let result = compiled.get(key);
    if (!result) {
      result = compileFormula(prop.config.expression, schemaOf(databaseId) ?? basicSchema([]));
      compiled.set(key, result);
    }
    return result;
  };

  /** A related database's context in this run (made on first use). */
  function contextOf(world: World, databaseId: Id): FormulaContext {
    let ctx = world.related.get(databaseId);
    if (!ctx) {
      ctx = {
        ...world.shared,
        properties: schemas.byId.get(databaseId)?.shown ?? [],
        computed: (row, propertyId) => world.elsewhere(row, propertyId),
      };
      world.related.set(databaseId, ctx);
    }
    return ctx;
  }

  const worlds = new WeakMap<ComputeContext, World>();
  function worldOf(engine: ComputeContext): World {
    const known = worlds.get(engine);
    if (known) return known;
    const page = (id: Id): { row: Row; ctx: FormulaContext } | null => {
      const own = engine.openRow(id);
      if (own) return { row: own, ctx: world.home };
      const hit = cache.rows.get(id);
      if (hit) return { row: hit.row, ctx: contextOf(world, hit.databaseId) };
      if (cache.skipped.has(id)) {
        slow = true;
        fail(QUERY_TOO_SLOW);
      }
      return null;
    };
    const shared: World['shared'] = {
      viewer,
      userName: (id) => people.name(id),
      isRemovedUser: (id) => people.removed(id),
      rowTitle: (id) => engine.rowTitle?.(id),
      page,
      userEmail: (id) => people.email(id),
      clock: budget.clock,
      budget,
    };
    const memo = new Map<Id, Map<Id, ComputedValue>>();
    const guarded = guardLoops((row, propertyId) => workElsewhere(world, row, propertyId));
    const world: World = {
      engine,
      shared,
      home: {
        ...shared,
        properties: engine.properties,
        computed: (row, propertyId) => engine.computed(row, propertyId),
      },
      related: new Map(),
      elsewhere(row, propertyId) {
        let byRow = memo.get(row.id);
        if (!byRow) memo.set(row.id, (byRow = new Map()));
        let value = byRow.get(propertyId);
        if (!value) {
          value = guarded(row, propertyId);
          byRow.set(propertyId, value);
        }
        return value;
      },
    };
    worlds.set(engine, world);
    return world;
  }

  /** A formula or rollup of a related row: empty unless the viewer can see it there. */
  function workElsewhere(world: World, row: Row, propertyId: Id): ComputedValue {
    const databaseId = cache.rows.get(row.id)?.databaseId;
    const db = databaseId ? schemas.byId.get(databaseId) : undefined;
    const prop = schemas.property(propertyId);
    if (!db || !prop || prop.databaseId !== db.id || !db.visible.has(propertyId)) return EMPTY;
    if (!isComputed(prop.property)) return EMPTY;
    if (budget.clock() > budget.deadline) return tooSlow();
    return evaluate(world, row, prop.property, db, contextOf(world, db.id));
  }

  function evaluate(
    world: World,
    row: Row,
    prop: Property,
    db: DatabaseSchema,
    ctx: FormulaContext,
  ): ComputedValue {
    const config = prop.config;
    if (config.type === 'formula') {
      const result = compiledFor(prop as Property<ConfigOf<'formula'>>, db.id);
      if (!result.ok) return { kind: 'error', message: result.error.message };
      const value = result.run(row, ctx);
      if (budget.spent) slow = true;
      return value;
    }
    if (config.type !== 'rollup') return EMPTY;
    if (linkIds(row.values[config.relationPropertyId]).some((id) => cache.skipped.has(id))) {
      return tooSlow();
    }
    const related = (from: Row, relationId: Id): RollupSource | null => {
      const rel = db.properties.find((p) => p.id === relationId);
      if (rel?.config.type !== 'relation') return null;
      const links = linkIds(from.values[relationId]);
      const target = schemas.byId.get(rel.config.targetDatabaseId);
      if (!target) return { rows: [], properties: [], ctx, total: links.length };
      const toHome = target.id === homeId;
      const rows = links.flatMap((id) => {
        if (toHome) {
          const own = world.engine.openRow(id);
          return own ? [own] : [];
        }
        const hit = cache.rows.get(id);
        return hit && hit.databaseId === target.id ? [hit.row] : [];
      });
      const targetCtx = toHome ? world.home : contextOf(world, target.id);
      return { rows, properties: target.shown, ctx: targetCtx, total: links.length };
    };
    return withinLimits(computeRollup(row, prop as Property<ConfigOf<'rollup'>>, related));
  }

  return {
    computed(row, propertyId, engine) {
      const prop = schemas.property(propertyId);
      if (!prop || prop.databaseId !== homeId || !isComputed(prop.property)) return EMPTY;
      const world = worldOf(engine);
      return evaluate(world, row, prop.property, schemas.home, world.home);
    },
    rowTitle: (id) => cache.rows.get(id)?.row.title,
    get timedOut() {
      return slow || budget.spent === true;
    },
  };
}
