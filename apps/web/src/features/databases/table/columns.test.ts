import { describe, expect, it } from 'vitest';
import type { View } from '@carehub/databases';
import { jobsDatabase, jobsProperties, PROPS } from '../test-utils';
import { clampWidth, tableColumns } from './columns';

function tableView(patch: Partial<View> = {}): View {
  const view = jobsDatabase().views[0];
  if (!view) throw new Error('The fixture needs a table view.');
  return { ...view, ...patch };
}

const ALL = jobsProperties().map((p) => p.id);
const ids = (view: View, visible: readonly string[] = ALL) =>
  tableColumns(jobsProperties(), view, visible).map((c) => c.property.id);

describe('tableColumns', () => {
  it('lists the visible properties in the view order, Name first', () => {
    const view = tableView({
      properties: [
        { propertyId: PROPS.cost, visible: true },
        { propertyId: PROPS.name, visible: true },
        { propertyId: PROPS.status, visible: false },
        { propertyId: PROPS.paid, visible: true },
      ],
    });
    expect(ids(view)).toEqual([PROPS.name, PROPS.cost, PROPS.paid]);
  });

  it('keeps Name even when the view leaves it out', () => {
    const view = tableView({ properties: [{ propertyId: PROPS.status, visible: true }] });
    expect(ids(view)).toEqual([PROPS.name, PROPS.status]);
  });

  it("leaves out properties the viewer can't see and ones that are gone", () => {
    const view = tableView({
      properties: [
        { propertyId: PROPS.name, visible: true },
        { propertyId: 'prop-deleted', visible: true },
        { propertyId: PROPS.cost, visible: true },
        { propertyId: PROPS.notes, visible: true },
      ],
    });
    expect(ids(view, [PROPS.name, PROPS.notes])).toEqual([PROPS.name, PROPS.notes]);
  });

  it('uses saved widths between 80 and 800 px, and the defaults without one', () => {
    const view = tableView({
      properties: [
        { propertyId: PROPS.name, visible: true },
        { propertyId: PROPS.status, visible: true, width: 40 },
        { propertyId: PROPS.cost, visible: true, width: 1200 },
        { propertyId: PROPS.notes, visible: true },
      ],
    });
    const widths = tableColumns(jobsProperties(), view, ALL).map((c) => c.width);
    expect(widths).toEqual([280, 80, 800, 200]);
    expect(clampWidth(150.4)).toBe(150);
  });

  it('freezes the columns up to and including the chosen one', () => {
    const view = tableView({
      table: { frozenUpTo: PROPS.priority, wrapCells: false, showVerticalLines: true },
    });
    const columns = tableColumns(jobsProperties(), view, ALL);
    expect(columns.filter((c) => c.frozen).map((c) => c.property.id)).toEqual([
      PROPS.name,
      PROPS.status,
      PROPS.priority,
    ]);
    expect(columns.slice(0, 3).map((c) => c.left)).toEqual([0, 280, 480]);
  });

  it('wraps a column when it says so, else when the view wraps all cells', () => {
    const view = tableView({
      properties: [
        { propertyId: PROPS.name, visible: true },
        { propertyId: PROPS.notes, visible: true, wrap: false },
        { propertyId: PROPS.status, visible: true },
      ],
      table: { frozenUpTo: null, wrapCells: true, showVerticalLines: true },
    });
    const wraps = tableColumns(jobsProperties(), view, ALL).map((c) => c.wrap);
    expect(wraps).toEqual([true, false, true]);
  });
});
