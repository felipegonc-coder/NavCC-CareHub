import { describe, expect, it } from 'vitest';
import type { QueryRow } from '../contract';
import { layoutProps, PROPS, queryData, renderWithDatabase, viewData } from '../test-utils';
import TableLayout from './layout';

/** The fixture's answer with some rows' conditional color set. */
function colored(colors: Record<string, QueryRow['color']>) {
  const data = queryData();
  return viewData({
    ...data,
    rows: data.rows.map((row) => ({ ...row, color: colors[row.id] ?? row.color })),
  });
}

const cellOf = (rowId: string, propertyId: string): HTMLElement => {
  const cell = document.querySelector<HTMLElement>(
    `[role="row"][data-row-id="${rowId}"] [data-property-id="${propertyId}"]`,
  );
  if (!cell) throw new Error(`No cell ${propertyId} in ${rowId}`);
  return cell;
};

describe('TableLayout conditional color', () => {
  it("colors a row's cells, and a cell rule wins in its cell", () => {
    const data = colored({ 'row-heater': { row: 'red', cells: { [PROPS.status]: 'green' } } });
    renderWithDatabase(<TableLayout {...layoutProps({ data })} />);
    expect(cellOf('row-heater', PROPS.name)).toHaveClass('bg-red-bg');
    expect(cellOf('row-heater', PROPS.cost)).toHaveClass('bg-red-bg');
    expect(cellOf('row-heater', PROPS.status)).toHaveClass('bg-green-bg');
    expect(cellOf('row-heater', PROPS.status)).not.toHaveClass('bg-red-bg');
    expect(cellOf('row-sink', PROPS.name)).not.toHaveClass('bg-red-bg');
  });

  it('colors only the cells with a cell rule when no row rule matches', () => {
    const data = colored({ 'row-sink': { row: null, cells: { [PROPS.cost]: 'yellow' } } });
    renderWithDatabase(<TableLayout {...layoutProps({ data })} />);
    expect(cellOf('row-sink', PROPS.cost)).toHaveClass('bg-yellow-bg');
    expect(cellOf('row-sink', PROPS.name).className).not.toMatch(/bg-\w+-bg/);
  });
});
