import { describe, expect, it } from 'vitest';
import { CASES_SCHEMA, CASE_ROW, VIEWER, fixtureContext } from './fixture-workspace';
import {
  EDITOR_MESSAGES,
  PHONE_KEYS,
  TEXT_AND_NUMBER,
  announcement,
  applyInsert,
  buttonFormulas,
  buttonInputValues,
  editorKey,
  editorState,
  formulaChips,
  functionGroups,
  functionInsert,
  highlightFormula,
  hoverAt,
  lineAndColumn,
  lineCount,
  listFunctions,
  matchBracket,
  propertyList,
  suggestAt,
} from './index';

const ctx = fixtureContext();
const labels = (source: string, cursor = source.length, explicit = false) =>
  suggestAt(source, cursor, CASES_SCHEMA, { explicit })?.items.map((i) => i.label) ?? null;
const BUTTON = buttonFormulas(CASES_SCHEMA, [{ id: 'v_n', name: 'Count', formula: '1' }]);

describe('formula editor: colors and brackets', () => {
  it('colors every part of the formula, in order', () => {
    const source = 'if(prop("Score") >= 90, "Pass", /* note */ "Review")';
    const tokens = highlightFormula(source);
    expect(tokens.map((t) => source.slice(t.start, t.end)).join('')).toBe(source);
    const shown = tokens
      .filter((t) => t.kind !== 'space')
      .map((t) => `${t.kind}:${source.slice(t.start, t.end)}`);
    expect(shown).toEqual([
      'function:if',
      'bracket:(',
      'function:prop',
      'bracket:(',
      'property:"Score"',
      'bracket:)',
      'operator:>=',
      'number:90',
      'operator:,',
      'text:"Pass"',
      'operator:,',
      'comment:/* note */',
      'text:"Review"',
      'bracket:)',
    ]);
    expect(tokens.filter((t) => t.kind === 'bracket').map((t) => t.depth)).toEqual([0, 1, 1, 0]);
  });

  it('keeps going past mistakes while the formula is typed', () => {
    const source = 'round(1 # 2 = "abc';
    const tokens = highlightFormula(source);
    expect(tokens.map((t) => source.slice(t.start, t.end)).join('')).toBe(source);
    expect(
      tokens.filter((t) => t.kind === 'error').map((t) => source.slice(t.start, t.end)),
    ).toEqual(['#', '=']);
    expect(tokens.find((t) => t.kind === 'bracket')).toMatchObject({ unmatched: true });
    expect(tokens.at(-1)).toMatchObject({ kind: 'text', unclosed: true });
    expect(highlightFormula('true and not false or not(x) /* open').map((t) => t.kind)).toEqual([
      'keyword',
      'space',
      'keyword',
      'space',
      'keyword',
      'space',
      'keyword',
      'space',
      'keyword',
      'space',
      'function',
      'bracket',
      'name',
      'bracket',
      'space',
      'comment',
    ]);
    expect(highlightFormula('😀')).toEqual([{ kind: 'error', start: 0, end: 2 }]);
  });

  it('finds the partner of the bracket next to the cursor, skipping texts', () => {
    const source = 'round(("(" + 2) * 3)';
    expect(matchBracket(source, 15)).toEqual({ bracket: 14, partner: 6 });
    expect(matchBracket(source, 5)).toEqual({ bracket: 5, partner: 19 });
    expect(matchBracket(source, 8)).toBeNull();
    expect(matchBracket('round(1', 6)).toEqual({ bracket: 5, partner: null });
    expect(matchBracket('1 + 2', 2)).toBeNull();
  });
});

describe('formula editor: lines and keys', () => {
  it('numbers lines and finds line and column', () => {
    expect(lineCount('')).toBe(1);
    expect(lineCount('1 +\n2\n')).toBe(3);
    expect(lineAndColumn('1 +\n22', 5)).toEqual({ line: 2, column: 2 });
    expect(lineAndColumn('abc', 99)).toEqual({ line: 1, column: 4 });
  });

  it('works by keyboard as §6 says', () => {
    expect(editorKey({ key: ' ', ctrlKey: true }, false)).toBe('suggest');
    expect(editorKey({ key: 'Enter' }, true)).toBe('accept');
    expect(editorKey({ key: 'Tab' }, true)).toBe('accept');
    expect(editorKey({ key: 'Enter' }, false)).toBeNull();
    expect(editorKey({ key: 'Tab' }, false)).toBeNull();
    expect(editorKey({ key: 'ArrowDown' }, true)).toBe('next');
    expect(editorKey({ key: 'ArrowUp' }, true)).toBe('previous');
    expect(editorKey({ key: 'Escape' }, true)).toBe('closeSuggestions');
    expect(editorKey({ key: 'Escape' }, false)).toBe('closeEditor');
    expect(editorKey({ key: 'Enter', ctrlKey: true }, true)).toBe('save');
    expect(editorKey({ key: 'Enter', metaKey: true }, false)).toBe('save');
  });

  it('has the phone keys, with a real minus', () => {
    expect(PHONE_KEYS.map((k) => k.label).join(' ')).toBe('( ) " , . + − * / =');
    expect(PHONE_KEYS.find((k) => k.label === '−')?.insert).toBe('-');
  });

  it('puts a picked item in place', () => {
    expect(applyInsert('1 + ro', 4, 6, 'round()', 6)).toEqual({
      source: '1 + round()',
      cursor: 10,
    });
  });
});

describe('formula editor: lists, chips and hover', () => {
  it('lists properties with their types, then the inputs', () => {
    const list = propertyList(CASES_SCHEMA);
    expect(list.find((p) => p.name === 'Score')).toEqual({
      id: 'p_score',
      name: 'Score',
      type: 'Number',
      propertyType: 'number',
      input: false,
      insert: 'prop("Score")',
    });
    expect(list.find((p) => p.name === 'Tasks')?.type).toBe('List of Row');
    expect(list.find((p) => p.name === 'Broken')?.type).toBeNull();
    expect(list.some((p) => p.name === 'Go')).toBe(false);
    const extras = propertyList(BUTTON.schemaFor()).filter((p) => p.input);
    expect(extras.map((p) => `${p.name}: ${p.type}`)).toEqual([
      'Pressed by: Person',
      'Pressed at: Date',
      'This row: Row',
      'Count: Number',
    ]);
  });

  it('groups functions as the spec does', () => {
    const groups = functionGroups();
    expect(groups.map((g) => g.label)).toEqual([
      'Logic',
      'Text',
      'Numbers',
      'Dates',
      'People and rows',
      'Lists',
    ]);
    const names = new Set(groups.flatMap((g) => g.functions.map((f) => f.name)));
    expect(names.size).toBe(listFunctions().length);
    const round = groups
      .find((g) => g.kind === 'numbers')
      ?.functions.find((f) => f.name === 'round');
    expect(round?.description).not.toBe('');
    expect(round?.example).not.toBe('');
    expect(functionInsert('round')).toEqual({ insert: 'round()', cursor: 6 });
    expect(functionInsert('now')).toEqual({ insert: 'now()', cursor: 5 });
    expect(functionInsert('length', true)).toEqual({ insert: 'length()', cursor: 8 });
    expect(functionInsert('prop')).toEqual({ insert: 'prop("")', cursor: 6 });
  });

  it('shows prop("…") as chips with the name and type, even while typing', () => {
    const source =
      'prop("score") + prop("Tasks").map(current.prop("Hours")).sum() + prop("Old score") + prop("Nope") + round(';
    const chips = formulaChips(source, CASES_SCHEMA);
    expect(chips.map((c) => [c.kind, c.name, c.type, c.propertyType])).toEqual([
      ['property', 'Score', 'Number', 'number'],
      ['property', 'Tasks', 'List of Row', 'relation'],
      ['property', 'Hours', 'Number', 'number'],
      ['deleted', 'Old score', null, null],
      ['unknown', 'Nope', null, null],
    ]);
    const hours = chips[2];
    expect(hours && source.slice(hours.start, hours.end)).toBe('prop("Hours")');
    expect(hours && source.slice(hours.keyStart, hours.keyEnd)).toBe('"Hours"');
    expect(formulaChips('prop("p_score")', CASES_SCHEMA)[0]).toMatchObject({ name: 'Score' });
    expect(formulaChips('name(prop("Pressed by"))', BUTTON.schemaFor())[0]).toMatchObject({
      kind: 'input',
      id: 'pressed_by',
      type: 'Person',
      propertyType: null,
    });
  });

  it('explains the function or chip under the pointer', () => {
    expect(hoverAt('round(1.25, 1)', 2, CASES_SCHEMA)).toMatchObject({
      start: 0,
      end: 5,
      title: 'round',
      detail: 'round(number, places?)',
    });
    expect(hoverAt('1 + prop("Score")', 8, CASES_SCHEMA)).toMatchObject({
      title: 'Score',
      detail: 'Number',
    });
    expect(hoverAt('1 + 2', 0, CASES_SCHEMA)).toBeNull();
  });
});

describe('formula editor: suggestions', () => {
  it('suggests functions, properties and values for the name being typed', () => {
    const list = suggestAt('1 + ro', 6, CASES_SCHEMA);
    expect(list?.from).toBe(4);
    expect(list?.to).toBe(6);
    expect(list?.items[0]).toMatchObject({
      kind: 'function',
      label: 'round',
      insert: 'round()',
      cursor: 6,
    });
    expect(labels('Sco')?.[0]).toBe('Score');
    expect(suggestAt('Sco', 3, CASES_SCHEMA)?.items[0]).toMatchObject({
      kind: 'property',
      insert: 'prop("Score")',
      detail: 'Number',
    });
    expect(labels('dateb')?.[0]).toBe('dateBetween');
    expect(labels('da')?.slice(0, 3)).toEqual(['day', 'date', 'dateAdd']);
    expect(labels('tr')?.includes('true')).toBe(true);
    expect(suggestAt('so', 1, CASES_SCHEMA)).toMatchObject({ from: 0, to: 2 });
  });

  it('suggests only when asked while nothing is typed, never in texts and comments', () => {
    expect(labels('1 + ')).toBeNull();
    expect(labels('1 + ', 4, true)?.length).toBe(50);
    expect(labels('"ro', 3)).toBeNull();
    expect(labels('/* ro */', 5)).toBeNull();
    expect(labels('', 0, true)?.[0]).toBe('Name');
  });

  it('suggests functions only after a dot', () => {
    const items = suggestAt('prop("Name").up', 15, CASES_SCHEMA)?.items ?? [];
    expect(items.map((i) => i.label)).toEqual(['upper']);
    expect(items[0]).toMatchObject({ insert: 'upper()', cursor: 7 });
  });

  it('suggests property names inside prop("…") and closes what is open', () => {
    expect(suggestAt('prop("Sc', 8, CASES_SCHEMA)).toMatchObject({
      from: 5,
      to: 8,
      items: [{ label: 'Score', insert: '"Score")' }],
    });
    expect(suggestAt('prop("Sc") + 1', 8, CASES_SCHEMA)?.items[0]).toMatchObject({
      label: 'Score',
      insert: '"Score"',
    });
    const related = suggestAt('prop("Tasks").map(current.prop("Ho', 34, CASES_SCHEMA);
    expect(related?.items.map((i) => [i.label, i.detail])).toEqual([['Hours', 'Number']]);
    expect(labels('prop("Pre', 9)).toEqual([]);
    expect(suggestAt('prop("Pre', 9, BUTTON.schemaFor())?.items.map((i) => i.label)).toEqual([
      'Pressed by',
      'Pressed at',
    ]);
  });

  it('suggests let names, and current and index inside list functions', () => {
    expect(labels('let(total, 2, to')?.[0]).toBe('total');
    expect(labels('lets(a, 1, bb, 2, b')?.[0]).toBe('bb');
    expect(labels('prop("Tags").map(cu')?.[0]).toBe('current');
    expect(labels('filter(prop("Tags"), ind')?.[0]).toBe('index');
    expect(labels('cu')?.includes('current')).toBe(false);
    expect(labels('filter(ind')?.includes('index')).toBe(false);
  });
});

describe('formula editor: the line under the code', () => {
  it('shows the result and its type for a valid formula', () => {
    const state = editorState('prop("Score") * 2', CASES_SCHEMA, { row: CASE_ROW, ctx });
    expect(state).toEqual({
      ok: true,
      expression: 'prop("p_score") * 2',
      kind: 'number',
      type: 'Number',
      value: { kind: 'number', value: 85 },
      message: 'Number · 85',
      problem: null,
    });
    const shown = (source: string) =>
      editorState(source, CASES_SCHEMA, { row: CASE_ROW, ctx }).message;
    expect(shown('prop("Done")')).toBe('Checkbox · false');
    expect(shown('prop("Created by")')).toBe('Person · Jordan Park');
    expect(shown('prop("Tags")')).toBe('List of Text · Urgent, Plumbing');
    expect(shown('prop("Budget")')).toBe('Number · Empty');
    expect(shown('/* nothing */')).toBe('Empty');
    expect(shown('split(repeat("a,", 104), ",")')).toMatch(
      /^List of Text · a, a, .*, a, \+4 more$/,
    );
  });

  it('shows "No rows to preview" when the view has no rows, and Done stays on', () => {
    expect(EDITOR_MESSAGES.noRows).toBe('No rows to preview');
    expect(editorState('prop("Score") + 1', CASES_SCHEMA, { row: null, ctx })).toEqual({
      ok: true,
      expression: 'prop("p_score") + 1',
      kind: 'number',
      type: 'Number',
      value: { kind: 'empty' },
      message: 'No rows to preview',
      problem: null,
    });
    expect(editorState('round(1,', CASES_SCHEMA, { row: null, ctx }).ok).toBe(false);
  });

  it('shows the problem with its line and place, and Done stays off', () => {
    expect(editorState('round(1,\n2', CASES_SCHEMA, { row: CASE_ROW, ctx })).toEqual({
      ok: false,
      message: "Missing ')' at line 2",
      problem: { start: 10, end: 10, line: 2, column: 2 },
    });
    const source = 'if(true,\n  "Score: " + 5, "")';
    const state = editorState(source, CASES_SCHEMA, { row: CASE_ROW, ctx });
    expect(state).toMatchObject({ ok: false, message: TEXT_AND_NUMBER });
    expect(state.problem && source.slice(state.problem.start, state.problem.end)).toBe(
      '"Score: " + 5',
    );
    expect(state.problem?.line).toBe(2);
  });

  it('says where a problem on the previewed row happened', () => {
    const source = '1 + prop("Late fee")';
    const state = editorState(source, CASES_SCHEMA, { row: CASE_ROW, ctx });
    expect(state).toMatchObject({ ok: true, message: 'This formula is too complex.' });
    expect(state.problem && source.slice(state.problem.start, state.problem.end)).toBe(
      'prop("Late fee")',
    );
  });

  it('previews button formulas with the press values', () => {
    const schema = BUTTON.schemaFor();
    const press = { userId: VIEWER.userId, at: VIEWER.now.toISOString(), rowId: CASE_ROW.id };
    const inputs = { ...buttonInputValues(press), v_n: { kind: 'number', value: 3 } } as const;
    const state = editorState('name(prop("Pressed by")) + " ×" + format(prop("Count"))', schema, {
      row: CASE_ROW,
      ctx,
      inputs,
    });
    expect(state).toMatchObject({
      ok: true,
      expression: 'name(prop("pressed_by")) + " ×" + format(prop("v_n"))',
      message: 'Text · Avery Lin ×3',
    });
  });

  it('tells screen readers about new problems only', () => {
    const typing = editorState('round(1', CASES_SCHEMA, { row: CASE_ROW, ctx });
    const valid = editorState('round(1)', CASES_SCHEMA, { row: CASE_ROW, ctx });
    expect(announcement(valid, typing)).toBe("Missing ')' at line 1");
    expect(announcement(typing, typing)).toBeNull();
    expect(announcement(typing, valid)).toBeNull();
  });
});
