import { describe, expect, it } from 'vitest';
import { layoutProps, PROPS, queryData, renderWithDatabase, viewData } from '../test-utils';
import TableLayout from './layout';

/** The fixture's answer with one job's page icon set. */
function withIcon() {
  const data = queryData();
  return viewData({
    ...data,
    rows: data.rows.map((row) => (row.id === 'row-heater' ? { ...row, icon: '🔧' } : row)),
  });
}

const nameCell = (rowId: string): HTMLElement => {
  const cell = document.querySelector<HTMLElement>(
    `[role="row"][data-row-id="${rowId}"] [data-property-id="${PROPS.name}"]`,
  );
  if (!cell) throw new Error(`No Name cell in ${rowId}`);
  return cell;
};

describe('TableLayout page icons', () => {
  it("shows a row's page icon before its Name", () => {
    renderWithDatabase(<TableLayout {...layoutProps({ data: withIcon() })} />);
    expect(nameCell('row-heater')).toHaveTextContent('🔧');
    expect(nameCell('row-sink')).not.toHaveTextContent('🔧');
  });

  it('leaves page icons out when the view has them off', () => {
    const props = layoutProps({ data: withIcon() });
    renderWithDatabase(<TableLayout {...props} view={{ ...props.view, showPageIcon: false }} />);
    expect(nameCell('row-heater')).not.toHaveTextContent('🔧');
  });
});
