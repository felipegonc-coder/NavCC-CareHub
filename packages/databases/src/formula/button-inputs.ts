/**
 * Formulas in buttons. Templates and buttons: "Define variables: Formulas worked out when pressed,
 * with Pressed by, Pressed at and This row as inputs". Formulas 3.5: "In buttons and automations,
 * formulas run on the row the action works on, and their extra values show in the Properties list".
 *
 * A button's formulas read Pressed by, Pressed at, This row and its variables like properties:
 * stored as prop("<id>"), shown as prop("Name") (toStoredFormula and toDisplayFormula with
 * schemaFor()). ../buttons runs a press and calls RunContext.evaluate; buttonEvaluator makes it.
 */
import type { ComputedValue, Id, Instant, Row } from '../types';
import {
  FORMULA_BROKE,
  compileFormula,
  type CompileResult,
  type CompiledFormula,
  type FormulaInputs,
} from './evaluate';
import { formulaDependencies } from './names';
import {
  DATE,
  EMPTY_TYPE,
  PERSON,
  type FormulaContext,
  type FormulaError,
  type FormulaInput,
  type FormulaSchema,
} from './registry';

/** The inputs' ids, as buttons.ts has them (BUTTON_INPUTS): prop("pressed_by") and so on. */
export const BUTTON_INPUT_IDS = {
  pressedBy: 'pressed_by',
  pressedAt: 'pressed_at',
  thisRow: 'this_row',
} as const;

/** The inputs' names in the editor's Properties list and in formulas as typed. */
export const BUTTON_INPUT_NAMES = {
  pressedBy: 'Pressed by',
  pressedAt: 'Pressed at',
  thisRow: 'This row',
} as const;

/** For a variable that reads itself or a later one (the same words as buttons.ts). */
export const usedTooSoon = (variable: string) => `'${variable}' is used before it's defined.`;

/** One variable of a "Define variables" step; its formula is stored with ids. */
export interface ButtonVariable {
  id: Id;
  name: string;
  formula: string;
}

/** Who pressed, when, and on which row: the values of Pressed by, Pressed at and This row. */
export interface ButtonPress {
  userId: Id;
  at: Instant;
  rowId: Id;
}

/** A button's formulas: what they can read (with types), and the variables' problems. */
export interface ButtonFormulas {
  /** Pressed by, Pressed at, This row, then the variables in order: the Properties list's extras. */
  readonly inputs: readonly FormulaInput[];
  /** The first problem in each variable's formula, by variable id (its type is then Empty). */
  readonly errors: ReadonlyMap<Id, FormulaError>;
  /**
   * The schema a step's formulas are checked and run with: the database of the row the step works
   * on (default: the button's), with the inputs. The same database gives the same schema.
   */
  schemaFor(rowSchema?: FormulaSchema): FormulaSchema;
  /** The schema for editing a variable's formula: the button's database with the inputs before it. */
  schemaForVariable(variableId: Id): FormulaSchema;
  /**
   * The values a press gives, worked out the way a press does: the inputs, then each variable on
   * the button's row in order. For the editor's preview; a variable's error stops there.
   */
  values(
    row: Row,
    ctx: FormulaContext,
    press: ButtonPress,
  ): { values: Record<Id, ComputedValue>; error: { variableId: Id; message: string } | null };
}

/** The values of Pressed by, Pressed at and This row for a press (as buttons.ts makes them). */
export function buttonInputValues(press: ButtonPress): Record<Id, ComputedValue> {
  return {
    [BUTTON_INPUT_IDS.pressedBy]: { kind: 'person', value: press.userId },
    [BUTTON_INPUT_IDS.pressedAt]: {
      kind: 'date',
      value: { start: press.at, end: null, hasTime: true },
    },
    [BUTTON_INPUT_IDS.thisRow]: { kind: 'page', value: press.rowId },
  };
}

/** The schema with these inputs (methods are called on the original, so classes work too). */
function withInputs(schema: FormulaSchema, inputs: readonly FormulaInput[]): FormulaSchema {
  return {
    properties: schema.properties,
    related: (id) => schema.related(id),
    kindOf: (prop) => schema.kindOf(prop),
    ...(schema.deleted ? { deleted: schema.deleted } : {}),
    inputs,
  };
}

/**
 * Works out what a button's formulas can read. `schema` is the button's database; `variables` are
 * those of its "Define variables" steps, in order. Each variable's type comes from its formula,
 * which can read the inputs and the variables before it.
 */
export function buttonFormulas(
  schema: FormulaSchema,
  variables: readonly ButtonVariable[],
): ButtonFormulas {
  const inputs: FormulaInput[] = [
    { id: BUTTON_INPUT_IDS.pressedBy, name: BUTTON_INPUT_NAMES.pressedBy, type: PERSON },
    { id: BUTTON_INPUT_IDS.pressedAt, name: BUTTON_INPUT_NAMES.pressedAt, type: DATE },
    {
      id: BUTTON_INPUT_IDS.thisRow,
      name: BUTTON_INPUT_NAMES.thisRow,
      type: { kind: 'page', schema, depth: 0, via: null },
    },
  ];
  const errors = new Map<Id, FormulaError>();
  const compiled: { id: Id; formula: CompiledFormula | null }[] = [];
  const before = new Map<Id, FormulaSchema>();
  const notYet = new Map(variables.map((v) => [v.id, v.name]));
  for (const v of variables) {
    const own = withInputs(schema, [...inputs]);
    before.set(v.id, own);
    const result = compileFormula(v.formula, own);
    if (result.ok) compiled.push({ id: v.id, formula: result });
    else {
      const early = formulaDependencies(v.formula).local.find((id) => notYet.has(id));
      const name = early === undefined ? undefined : notYet.get(early);
      const error =
        name === undefined ? result.error : { ...result.error, message: usedTooSoon(name) };
      errors.set(v.id, error);
      compiled.push({ id: v.id, formula: null });
    }
    notYet.delete(v.id);
    inputs.push({ id: v.id, name: v.name, type: result.ok ? result.type : EMPTY_TYPE });
  }
  const schemas = new Map<FormulaSchema, FormulaSchema>();
  const schemaFor = (rowSchema: FormulaSchema = schema): FormulaSchema => {
    let s = schemas.get(rowSchema);
    if (!s) schemas.set(rowSchema, (s = withInputs(rowSchema, inputs)));
    return s;
  };
  return {
    inputs,
    errors,
    schemaFor,
    schemaForVariable: (id) => before.get(id) ?? schemaFor(),
    values(row, ctx, press) {
      const values = buttonInputValues(press);
      for (const v of compiled) {
        const value: ComputedValue = v.formula
          ? v.formula.run(row, ctx, values)
          : { kind: 'error', message: errors.get(v.id)?.message ?? FORMULA_BROKE };
        if (value.kind === 'error') {
          return { values, error: { variableId: v.id, message: value.message } };
        }
        values[v.id] = value;
      }
      return { values, error: null };
    },
  };
}

/** The database a press's row is in: its schema and the context its formulas run in. */
export interface ButtonRowDatabase {
  schema: FormulaSchema;
  ctx: FormulaContext;
}

/**
 * RunContext.evaluate for presses of one button: compiles each formula once per database, then runs
 * it on the row with the press's values (Pressed by, Pressed at, This row and the variables so far).
 * `database(row)` finds the row's database: the button's own, or an "Add row" or "Edit rows" step's.
 * Problems come back as { kind: "error" } with the editor's message.
 */
export function buttonEvaluator(
  formulas: ButtonFormulas,
  database: (row: Row) => ButtonRowDatabase | null,
): (formula: string, row: Row, values: FormulaInputs) => ComputedValue {
  const cache = new Map<FormulaSchema, Map<string, CompileResult>>();
  return (formula, row, values) => {
    const db = database(row);
    if (!db) return { kind: 'error', message: FORMULA_BROKE };
    const schema = formulas.schemaFor(db.schema);
    let compiled = cache.get(schema);
    if (!compiled) cache.set(schema, (compiled = new Map()));
    let result = compiled.get(formula);
    if (!result) compiled.set(formula, (result = compileFormula(formula, schema)));
    return result.ok
      ? result.run(row, db.ctx, values)
      : { kind: 'error', message: result.error.message };
  };
}

/**
 * RunContext.formulaReads: every id a stored formula reads with prop("<id>"), on its own row or on
 * related rows (This row's properties too). Inputs and variables are in it; they aren't properties.
 */
export function buttonFormulaReads(formula: string): Id[] {
  const deps = formulaDependencies(formula);
  return [...new Set([...deps.local, ...deps.related.map((r) => r.propertyId)])];
}
