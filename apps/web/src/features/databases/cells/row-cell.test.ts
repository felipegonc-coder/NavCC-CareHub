import { describe, expect, it } from 'vitest';
import { jobsProperties, jobsRows, PRIORITY, PROPS, queryRow, USERS } from '../fixtures';
import { rowCell } from './row-cell';
import { CUSTOMERS, prop } from './test-helpers';

const sink = () => {
  const row = jobsRows()[0];
  if (!row) throw new Error('No rows');
  return queryRow(row);
};
const job = (id: string) => {
  const found = jobsProperties().find((p) => p.id === id);
  if (!found) throw new Error(`No property ${id}`);
  return found;
};

describe('rowCell', () => {
  it('reads stored values and the Name', () => {
    expect(rowCell(sink(), job(PROPS.name))).toEqual({ value: 'Fix kitchen sink leak' });
    expect(rowCell(sink(), job(PROPS.priority))).toEqual({ value: PRIORITY.high });
    expect(rowCell(sink(), job(PROPS.technician))).toEqual({ value: [USERS.avery.id] });
    expect(rowCell(sink(), prop({ type: 'unique_id', prefix: 'JOB' }))).toEqual({ value: '1' });
  });

  it('gives a formula’s result, or empty when the answer has none', () => {
    const total = prop({ type: 'formula', expression: '1', resultKind: 'number', number: null });
    const row = { ...sink(), computed: { [total.id]: { kind: 'number' as const, value: 3 } } };
    expect(rowCell(row, total)).toEqual({ value: null, computed: { kind: 'number', value: 3 } });
    expect(rowCell(sink(), total)).toEqual({ value: null, computed: { kind: 'empty' } });
  });

  it('gives created and edited times as dates with a time', () => {
    const created = prop({ type: 'created_time', format: 'full', timeFormat: 'viewer' });
    expect(rowCell(sink(), created)).toEqual({
      value: { start: '2026-10-20T16:00:00.000Z', end: null, hasTime: true },
    });
    const edited = prop({ type: 'edited_time', format: 'full', timeFormat: 'viewer' });
    expect(rowCell({ ...sink(), editedAt: null }, edited)).toEqual({ value: null });
  });

  it('counts relation links the viewer can’t open', () => {
    const customers = prop({
      type: 'relation',
      targetDatabaseId: 'db-customers',
      single: false,
      twoWayPropertyId: null,
    });
    const row = {
      ...sink(),
      values: { [customers.id]: [CUSTOMERS.bluePine] },
      hiddenLinks: { [customers.id]: 2 },
    };
    expect(rowCell(row, customers)).toEqual({ value: [CUSTOMERS.bluePine], hiddenLinks: 2 });
    expect(rowCell(sink(), customers)).toEqual({ value: null, hiddenLinks: 0 });
  });
});
