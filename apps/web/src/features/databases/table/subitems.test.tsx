import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { View } from '@carehub/databases';
import type { QueryRow } from '../contract';
import {
  jobsDatabase,
  jobsRows,
  layoutProps,
  PROPS,
  queryData,
  queryRow,
  viewData,
} from '../test-utils';
import TableLayout from './layout';

const rowOf = (rowId: string): HTMLElement => {
  const row = document.querySelector<HTMLElement>(`[role="row"][data-row-id="${rowId}"]`);
  if (!row) throw new Error(`No row ${rowId}`);
  return row;
};
const nameOf = (rowId: string): HTMLElement => {
  const cell = rowOf(rowId).querySelector<HTMLElement>(`[data-property-id="${PROPS.name}"]`);
  if (!cell) throw new Error(`No Name in ${rowId}`);
  return cell;
};
const shownRows = () =>
  [...document.querySelectorAll('[role="row"][data-row-id]')].map((row) =>
    row.getAttribute('data-row-id'),
  );

/** Fix kitchen sink leak, with Replace water heater and Annual boiler service under it; Unclog bathroom drain. */
function nestedRows(context = false): QueryRow[] {
  const [sink, heater, boiler, drain] = jobsRows().map(queryRow);
  if (!sink || !heater || !boiler || !drain) throw new Error('The fixture needs four rows.');
  return [
    { ...sink, depth: 0, parentId: null, childCount: 2, context },
    { ...heater, depth: 1, parentId: 'row-sink', childCount: 0, context: false },
    { ...boiler, depth: 1, parentId: 'row-sink', childCount: 0, context: false },
    { ...drain, depth: 0, parentId: null, childCount: 0, context: false },
  ];
}

function nestedProps({
  context = false,
  subItems,
}: { context?: boolean; subItems?: View['subItems'] } = {}) {
  const meta = {
    ...jobsDatabase(),
    subItems: { parentPropertyId: 'prop-parent', childrenPropertyId: 'prop-children' },
  };
  const saved = meta.views[0];
  if (!saved) throw new Error('The fixture needs a table view.');
  const view: View = subItems ? { ...saved, subItems } : saved;
  return layoutProps({ meta, view, data: viewData({ ...queryData(), rows: nestedRows(context) }) });
}

const arrow = () => screen.getByRole('button', { name: 'Sub-items of Fix kitchen sink leak' });

beforeEach(() => {
  window.localStorage.clear();
});

describe('TableLayout sub-items', () => {
  it('starts with sub-items closed; the arrow and → open them, ← closes them', () => {
    render(<TableLayout {...nestedProps()} />);
    expect(shownRows()).toEqual(['row-sink', 'row-drain']);
    expect(arrow()).toHaveAttribute('aria-expanded', 'false');
    expect(within(rowOf('row-drain')).queryByRole('button', { name: /^Sub-items of/ })).toBeNull();

    fireEvent.click(arrow());
    expect(shownRows()).toEqual(['row-sink', 'row-heater', 'row-boiler', 'row-drain']);
    expect(arrow()).toHaveAttribute('aria-expanded', 'true');
    expect(nameOf('row-sink')).toHaveFocus();

    fireEvent.keyDown(nameOf('row-sink'), { key: 'ArrowLeft' });
    expect(shownRows()).toEqual(['row-sink', 'row-drain']);
    expect(nameOf('row-sink')).toHaveFocus();
    fireEvent.keyDown(nameOf('row-sink'), { key: 'ArrowRight' });
    expect(shownRows()).toEqual(['row-sink', 'row-heater', 'row-boiler', 'row-drain']);
    expect(nameOf('row-sink')).toHaveFocus();
    // Open already: → moves on as usual.
    fireEvent.keyDown(nameOf('row-sink'), { key: 'ArrowRight' });
    expect(rowOf('row-sink').querySelector(`[data-property-id="${PROPS.status}"]`)).toHaveFocus();
  });

  it('starts context rows open, and shows no arrows when flattened', () => {
    const { unmount } = render(<TableLayout {...nestedProps({ context: true })} />);
    expect(shownRows()).toEqual(['row-sink', 'row-heater', 'row-boiler', 'row-drain']);
    expect(rowOf('row-sink')).toHaveClass('text-muted');
    unmount();

    render(<TableLayout {...nestedProps({ subItems: 'flattened' })} />);
    expect(screen.queryByRole('button', { name: /^Sub-items of/ })).toBeNull();
  });

  it('moves a sub-item among the rows under the same parent', () => {
    const props = nestedProps();
    render(<TableLayout {...props} />);
    fireEvent.click(arrow());
    fireEvent.click(
      within(rowOf('row-boiler')).getByRole('button', {
        name: 'Row menu for Annual boiler service',
      }),
    );
    expect(screen.getByRole('menuitem', { name: 'Move down' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
    expect(props.actions.moveRow).toHaveBeenCalledWith('row-boiler', { beforeRowId: 'row-heater' });

    fireEvent.click(
      within(rowOf('row-sink')).getByRole('button', { name: 'Row menu for Fix kitchen sink leak' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect(props.actions.moveRow).toHaveBeenLastCalledWith('row-sink', { beforeRowId: null });
  });
});
