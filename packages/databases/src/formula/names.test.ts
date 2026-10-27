import { describe, expect, it } from 'vitest';
import type { Property } from '../types';
import { CASE_PROPERTIES, CASES_SCHEMA } from './fixtures';
import {
  CHAIN_MESSAGE,
  LOOP_MESSAGE,
  computedChainError,
  cycleMessage,
  findComputedCycle,
  formulaDependencies,
  toDisplayFormula,
  toStoredFormula,
  type ComputedNode,
} from './index';

describe('toStoredFormula', () => {
  it('writes property names as ids and keeps the rest as typed', () => {
    expect(toStoredFormula('prop("Score") /* pts */ +\n  prop("score")', CASES_SCHEMA)).toEqual({
      ok: true,
      expression: 'prop("p_score") /* pts */ +\n  prop("p_score")',
      kind: 'number',
    });
  });

  it('writes related properties with the related database ids', () => {
    const stored = toStoredFormula('prop("Tasks").map(current.prop("Hours"))', CASES_SCHEMA);
    expect(stored).toMatchObject({
      ok: true,
      expression: 'prop("p_tasks").map(current.prop("tk_hours"))',
    });
  });

  it('takes a plain property list too', () => {
    expect(toStoredFormula('prop("Name")', CASE_PROPERTIES)).toMatchObject({
      ok: true,
      expression: 'prop("p_name")',
      kind: 'text',
    });
  });

  it('gives the first problem with its place', () => {
    expect(toStoredFormula('1 + prop("Scroe")', CASES_SCHEMA)).toEqual({
      ok: false,
      error: { message: `Property "Scroe" doesn't exist.`, start: 9, end: 16 },
    });
  });
});

describe('toDisplayFormula', () => {
  it('shows names, deleted properties included', () => {
    const stored = 'prop("p_tasks").map(current.prop("tk_hours")) + prop("p_old") + prop("gone")';
    expect(toDisplayFormula(stored, CASES_SCHEMA)).toBe(
      'prop("Tasks").map(current.prop("Hours")) + prop("Old score") + prop("gone")',
    );
    expect(toDisplayFormula('prop("p_x")', CASES_SCHEMA, [{ id: 'p_x', name: 'Was here' }])).toBe(
      'prop("Was here")',
    );
  });

  it('escapes names and goes back to the same stored formula', () => {
    const props: Property[] = [
      ...CASE_PROPERTIES,
      {
        id: 'p_q',
        name: 'Say "hi" \\ now',
        description: '',
        config: { type: 'text' },
        rowPage: 'always',
      },
    ];
    const shown = toDisplayFormula('prop("p_q") + "!"', props);
    expect(shown).toBe('prop("Say \\"hi\\" \\\\ now") + "!"');
    expect(toStoredFormula(shown, props)).toMatchObject({
      ok: true,
      expression: 'prop("p_q") + "!"',
    });
  });

  it('leaves formulas it cannot read as they are', () => {
    expect(toDisplayFormula('prop("p_score" +', CASES_SCHEMA)).toBe('prop("p_score" +');
  });
});

describe('formulaDependencies', () => {
  it('lists own and related properties', () => {
    const f =
      'let(t, prop("p_tasks"), t.map(current.prop("tk_hours")).sum() + t.first().prop("tk_project").first().prop("pj_client").length()) + prop("p_score")';
    expect(formulaDependencies(f)).toEqual({
      local: ['p_tasks', 'p_score'],
      related: [
        { relationPropertyId: 'p_tasks', propertyId: 'tk_hours' },
        { relationPropertyId: 'p_tasks', propertyId: 'tk_project' },
        { relationPropertyId: 'tk_project', propertyId: 'pj_client' },
      ],
    });
  });

  it('reads nothing from formulas it cannot read', () => {
    expect(formulaDependencies('prop(')).toEqual({ local: [], related: [] });
  });
});

describe('loops', () => {
  const graph =
    (edges: Record<string, string[]>) =>
    (id: string): ComputedNode | undefined =>
      edges[id] ? { id, name: id.toUpperCase(), uses: edges[id] } : undefined;

  it('finds a formula that uses itself', () => {
    const lookup = graph({ late: ['days'], days: ['late'] });
    const start = { id: 'days', name: 'Days open', uses: ['late'] };
    expect(findComputedCycle(start, lookup)).toEqual(['Days open', 'LATE']);
    expect(cycleMessage(['Days open', 'Late?'])).toBe("'Days open' uses itself through 'Late?'.");
    expect(cycleMessage(['Total'])).toBe("'Total' uses itself.");
    expect(cycleMessage(['A', 'B', 'C'])).toBe("'A' uses itself through 'B' and 'C'.");
    expect(findComputedCycle({ id: 'x', name: 'X', uses: ['x'] }, lookup)).toEqual(['X']);
  });

  it('is fine without a loop, even when formulas share inputs', () => {
    const lookup = graph({ a: ['c'], b: ['c'], c: [] });
    expect(findComputedCycle({ id: 's', name: 'S', uses: ['a', 'b'] }, lookup)).toBeNull();
    expect(computedChainError({ id: 's', name: 'S', uses: ['a', 'b'] }, lookup)).toBeNull();
  });

  it('refuses chains deeper than 10', () => {
    const edges: Record<string, string[]> = {};
    for (let i = 1; i < 12; i++) edges[`f${i}`] = i < 11 ? [`f${i + 1}`] : [];
    const start = { id: 'f0', name: 'F0', uses: ['f1'] };
    expect(findComputedCycle(start, graph(edges))).toHaveLength(11);
    expect(computedChainError(start, graph(edges))).toBe(CHAIN_MESSAGE);
    expect(CHAIN_MESSAGE).toBe('Formulas can use other formulas and rollups up to 10 levels deep.');
    const short = { id: 'f0', name: 'F0', uses: ['f3'] };
    expect(findComputedCycle(short, graph(edges))).toBeNull();
  });

  it('says a rollup would make a loop', () => {
    const lookup = graph({ total: ['sum'] });
    expect(computedChainError({ id: 'sum', name: 'Sum', uses: ['total'] }, lookup, 'rollup')).toBe(
      LOOP_MESSAGE,
    );
    expect(computedChainError({ id: 'sum', name: 'Sum', uses: ['total'] }, lookup)).toBe(
      "'Sum' uses itself through 'TOTAL'.",
    );
  });
});
