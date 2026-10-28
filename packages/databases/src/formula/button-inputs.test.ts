import { describe, expect, it } from 'vitest';
import {
  BUTTON_INPUTS,
  BUTTON_MESSAGES,
  planRun,
  type ButtonConfig,
  type ButtonDatabase,
  type RunContext,
} from '../buttons';
import { plainText } from '../richtext';
import type { ButtonAction, Property, RichText, Row } from '../types';
import {
  CASES_SCHEMA,
  CASE_PROPERTIES,
  CASE_ROW,
  TASKS_SCHEMA,
  TASK_PROPERTIES,
  VIEWER,
  fixtureContext,
} from './fixture-workspace';
import {
  BUTTON_INPUT_IDS,
  buttonEvaluator,
  buttonFormulaReads,
  buttonFormulas,
  compileFormula,
  toDisplayFormula,
  toStoredFormula,
  typeName,
  usedTooSoon,
  type ButtonRowDatabase,
  type FormulaContext,
} from './index';

const AT = VIEWER.now.toISOString();
const PRESS = { userId: VIEWER.userId, at: AT, rowId: CASE_ROW.id };
const VARIABLES = [
  {
    id: 'v_hours',
    name: 'Hours left',
    formula:
      'prop("p_tasks").filter(not current.prop("tk_done")).map(current.prop("tk_hours")).sum()',
  },
  {
    id: 'v_note',
    name: 'Note',
    formula: '"Closed by " + name(prop("pressed_by")) + ", " + format(prop("v_hours")) + " h left"',
  },
  { id: 'v_late', name: 'Late', formula: 'prop("pressed_at") > prop("p_due")' },
];

/** The Cases row's context, where This row (case_1) can be opened from the Tasks rows too. */
const cases = fixtureContext();
const page: FormulaContext['page'] = (id) =>
  id === CASE_ROW.id ? { row: CASE_ROW, ctx: cases } : cases.page(id);
const tasks: FormulaContext = { ...cases, properties: TASK_PROPERTIES, page };
const databaseOf = (row: Row): ButtonRowDatabase | null =>
  row.id.startsWith('case_')
    ? { schema: CASES_SCHEMA, ctx: cases }
    : row.id.startsWith('t_')
      ? { schema: TASKS_SCHEMA, ctx: tasks }
      : null;

describe('button formulas', () => {
  it('uses the ids buttons.ts gives Pressed by, Pressed at and This row', () => {
    expect(BUTTON_INPUT_IDS).toEqual(BUTTON_INPUTS);
    expect(usedTooSoon('Total')).toBe(BUTTON_MESSAGES.usedTooSoon('Total'));
  });

  it('lists the inputs, then the variables with the types their formulas give', () => {
    const f = buttonFormulas(CASES_SCHEMA, VARIABLES);
    expect(f.inputs.map((i) => `${i.name}: ${typeName(i.type)}`)).toEqual([
      'Pressed by: Person',
      'Pressed at: Date',
      'This row: Row',
      'Hours left: Number',
      'Note: Text',
      'Late: Checkbox',
    ]);
    expect([...f.errors]).toEqual([]);
    expect(f.schemaFor()).toBe(f.schemaFor(CASES_SCHEMA));
    expect(f.schemaForVariable('v_note').inputs?.map((i) => i.id)).toEqual([
      'pressed_by',
      'pressed_at',
      'this_row',
      'v_hours',
    ]);
  });

  it('stores inputs and variables by id and shows them by name', () => {
    const schema = buttonFormulas(CASES_SCHEMA, VARIABLES).schemaFor();
    const typed =
      'if(prop("Late"), prop("Note"), name(prop("Pressed by")) + " " + prop("This row").prop("Name"))';
    const stored = toStoredFormula(typed, schema);
    expect(stored).toEqual({
      ok: true,
      expression:
        'if(prop("v_late"), prop("v_note"), name(prop("pressed_by")) + " " + prop("this_row").prop("p_name"))',
      kind: 'text',
    });
    if (!stored.ok) return;
    expect(toDisplayFormula(stored.expression, schema)).toBe(typed);
    // Without the button's inputs they aren't there.
    expect(toStoredFormula('prop("Pressed by")', CASES_SCHEMA)).toMatchObject({
      ok: false,
      error: { message: 'Property "Pressed by" doesn\'t exist.' },
    });
    expect(toStoredFormula('prop("Name").prop("Pressed by")', schema)).toMatchObject({
      ok: false,
    });
  });

  it('reads a variable before a property with its name, and keeps that property by id', () => {
    const f = buttonFormulas(CASES_SCHEMA, [
      { id: 'v_status', name: 'Status', formula: '"Closed"' },
    ]);
    const schema = f.schemaFor();
    expect(toStoredFormula('prop("Status")', schema)).toMatchObject({
      expression: 'prop("v_status")',
    });
    const shown = toDisplayFormula('prop("p_status") + " → " + prop("v_status")', schema);
    expect(shown).toBe('prop("p_status") + " → " + prop("Status")');
    expect(toStoredFormula(shown, schema)).toMatchObject({
      expression: 'prop("p_status") + " → " + prop("v_status")',
    });
    expect(compileFormula('Status', schema)).toMatchObject({
      error: { message: 'Use prop("Status") to read a property.' },
    });
  });

  it('refuses a variable that reads itself or a later one, and goes on with the rest', () => {
    const f = buttonFormulas(CASES_SCHEMA, [
      { id: 'v_a', name: 'A', formula: 'prop("v_b") + 1' },
      { id: 'v_b', name: 'B', formula: '2' },
      { id: 'v_c', name: 'C', formula: 'prop("v_c")' },
      { id: 'v_d', name: 'D', formula: 'prop("v_a") * prop("v_b")' },
      { id: 'v_e', name: 'E', formula: 'round(1' },
    ]);
    expect([...f.errors].map(([id, e]) => [id, e.message])).toEqual([
      ['v_a', "'B' is used before it's defined."],
      ['v_c', "'C' is used before it's defined."],
      ['v_e', "Missing ')' at line 1"],
    ]);
    expect(f.inputs.map((i) => typeName(i.type)).slice(3)).toEqual([
      'Empty',
      'Number',
      'Empty',
      'Number',
      'Empty',
    ]);
    expect(f.values(CASE_ROW, cases, PRESS).error).toEqual({
      variableId: 'v_a',
      message: "'B' is used before it's defined.",
    });
  });

  it('works out the variables in order for the preview', () => {
    const { values, error } = buttonFormulas(CASES_SCHEMA, VARIABLES).values(
      CASE_ROW,
      cases,
      PRESS,
    );
    expect(error).toBeNull();
    expect(values).toEqual({
      pressed_by: { kind: 'person', value: 'u_avery' },
      pressed_at: { kind: 'date', value: { start: AT, end: null, hasTime: true } },
      this_row: { kind: 'page', value: 'case_1' },
      v_hours: { kind: 'number', value: 1.5 },
      v_note: { kind: 'text', value: 'Closed by Avery Lin, 1.5 h left' },
      v_late: { kind: 'boolean', value: false },
    });
  });

  it('runs formulas on the row given, with the press values; problems come back as errors', () => {
    const evaluate = buttonEvaluator(buttonFormulas(CASES_SCHEMA, VARIABLES), databaseOf);
    const values = { pressed_by: { kind: 'person', value: 'u_jordan' } } as const;
    expect(evaluate('name(prop("pressed_by"))', CASE_ROW, values)).toEqual({
      kind: 'text',
      value: 'Jordan Park',
    });
    // A value not given yet is empty.
    expect(evaluate('empty(prop("v_note"))', CASE_ROW, values)).toEqual({
      kind: 'boolean',
      value: true,
    });
    const task = tasks.page('t_call')?.row;
    if (!task) throw new Error('no task');
    const onTask = 'prop("tk_name") + " for " + prop("this_row").prop("p_name")';
    expect(evaluate(onTask, task, { this_row: { kind: 'page', value: 'case_1' } })).toEqual({
      kind: 'text',
      value: 'Call Blue Pine Plumbing for Avery Lin intake',
    });
    expect(evaluate('prop("p_score")', task, {})).toEqual({
      kind: 'error',
      message: 'A property this formula uses was deleted.',
    });
    expect(evaluate('1', { ...CASE_ROW, id: 'elsewhere' }, {})).toEqual({
      kind: 'error',
      message: "This formula couldn't be worked out.",
    });
    expect(
      evaluate('prop("v_hours") + 1', CASE_ROW, { v_hours: { kind: 'error', message: 'Nope' } }),
    ).toEqual({ kind: 'error', message: 'Nope' });
  });

  it('lists every id a formula reads, on its row and on related rows', () => {
    expect(
      buttonFormulaReads('prop("v_hours") + prop("this_row").prop("p_score") + prop("v_hours")'),
    ).toEqual(['v_hours', 'this_row', 'p_score']);
    expect(buttonFormulaReads('round(')).toEqual([]);
  });

  it('runs a whole press with buttons.ts', () => {
    const actions: ButtonAction[] = [
      { kind: 'define_variables', variables: VARIABLES },
      {
        kind: 'set_values',
        values: {},
        edits: {
          p_notes: { formula: 'prop("v_note")' },
          p_done: { formula: 'prop("v_hours") < 2' },
        },
      },
      {
        kind: 'edit_rows',
        databaseId: 'db_tasks',
        filter: null,
        edits: {
          tk_hours: { formula: 'prop("tk_hours") + prop("this_row").prop("p_score") / 42.5' },
        },
      },
    ];
    const button: Property<ButtonConfig> = {
      id: 'p_close',
      name: 'Close case',
      description: '',
      rowPage: 'always',
      config: { type: 'button', label: 'Close case', actions },
    };
    const taskRows = ['t_fix', 't_call'].flatMap((id) => tasks.page(id)?.row ?? []);
    const db = (id: string, title: string, properties: readonly Property[], rows: Row[]) =>
      ({ id, title, properties, access: 'edit_content', rows }) satisfies ButtonDatabase;
    const casesDb = db('db_cases', 'Cases', CASE_PROPERTIES, [CASE_ROW]);
    const tasksDb = db('db_tasks', 'Tasks', TASK_PROPERTIES, taskRows);
    const formulas = buttonFormulas(CASES_SCHEMA, VARIABLES);
    const ctx: RunContext = {
      presser: VIEWER,
      database: casesDb,
      databaseById: (id) => (id === tasksDb.id ? tasksDb : null),
      rowAccess: () => 'edit_content',
      canSeeProperty: () => true,
      canChangeProperty: () => true,
      evaluate: buttonEvaluator(formulas, databaseOf),
      formulaReads: buttonFormulaReads,
      userName: (id) => (id === 'u_avery' ? 'Avery Lin' : undefined),
      membersOf: () => null,
      everyone: () => [],
    };
    const plan = planRun(button, CASE_ROW, ctx);
    if (plan.status !== 'ready') throw new Error(JSON.stringify(plan));
    const [edit, edits] = plan.steps;
    if (edit?.kind !== 'set_values' || edits?.kind !== 'edit_rows') throw new Error('steps');
    const after = edit.changes[0]?.after ?? {};
    expect(plainText(after.p_notes as RichText)).toBe('Closed by Avery Lin, 1.5 h left');
    expect(after.p_done).toBe(true);
    expect(edits.changes.map((c) => [c.rowId, c.after.tk_hours])).toEqual([
      ['t_fix', '3'],
      ['t_call', '2.5'],
    ]);
  });
});
