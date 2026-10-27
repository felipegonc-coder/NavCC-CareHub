import { describe, expect, it } from 'vitest';
import type { View, ViewPropertySetting } from '@carehub/databases';
import { jobsDatabase, PROPS } from '../test-utils';
import { moveSetting, withCalculation, withSetting, withTableOptions } from './view-settings';

const SETTINGS: ViewPropertySetting[] = [
  { propertyId: PROPS.name, visible: true },
  { propertyId: PROPS.status, visible: true, width: 160 },
  { propertyId: PROPS.cost, visible: false },
];

const order = (settings: readonly ViewPropertySetting[]) => settings.map((s) => s.propertyId);

describe('withSetting', () => {
  it("changes one property's setting and keeps the rest", () => {
    const next = withSetting(SETTINGS, PROPS.status, { width: 240, wrap: true });
    expect(next[1]).toEqual({ propertyId: PROPS.status, visible: true, width: 240, wrap: true });
    expect(next[0]).toBe(SETTINGS[0]);
    expect(SETTINGS[1]?.width).toBe(160);
  });

  it('adds a hidden setting at the end for a property the view leaves out', () => {
    const next = withSetting(SETTINGS, PROPS.paid, { width: 120 });
    expect(next.at(-1)).toEqual({ propertyId: PROPS.paid, visible: false, width: 120 });
    expect(withSetting(SETTINGS, PROPS.paid, { visible: true }).at(-1)?.visible).toBe(true);
  });
});

describe('moveSetting', () => {
  it('puts a property just before another', () => {
    expect(order(moveSetting(SETTINGS, PROPS.cost, PROPS.status))).toEqual([
      PROPS.name,
      PROPS.cost,
      PROPS.status,
    ]);
  });

  it('puts a property at the end', () => {
    expect(order(moveSetting(SETTINGS, PROPS.name, null))).toEqual([
      PROPS.status,
      PROPS.cost,
      PROPS.name,
    ]);
  });

  it('leaves the order alone for an unknown property or a move onto itself', () => {
    expect(order(moveSetting(SETTINGS, 'prop-gone', PROPS.name))).toEqual(order(SETTINGS));
    expect(order(moveSetting(SETTINGS, PROPS.status, PROPS.status))).toEqual(order(SETTINGS));
  });
});

describe('withCalculation', () => {
  it('sets a calculation, and None removes it', () => {
    const calculations: View['calculations'] = { [PROPS.cost]: 'sum' };
    expect(withCalculation(calculations, PROPS.status, 'count_empty')).toEqual({
      [PROPS.cost]: 'sum',
      [PROPS.status]: 'count_empty',
    });
    expect(withCalculation(calculations, PROPS.cost, 'none')).toEqual({});
    expect(calculations).toEqual({ [PROPS.cost]: 'sum' });
  });
});

describe('withTableOptions', () => {
  it('fills in the defaults for a view that has no table options yet', () => {
    const view = jobsDatabase().views[0];
    if (!view) throw new Error('The fixture needs a table view.');
    expect(withTableOptions({ ...view, table: undefined }, { wrapCells: true })).toEqual({
      frozenUpTo: null,
      wrapCells: true,
      showVerticalLines: true,
    });
    expect(
      withTableOptions(
        {
          ...view,
          table: { frozenUpTo: PROPS.status, wrapCells: false, showVerticalLines: false },
        },
        { frozenUpTo: null },
      ),
    ).toEqual({ frozenUpTo: null, wrapCells: false, showVerticalLines: false });
  });
});
