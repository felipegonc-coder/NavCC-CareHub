import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@carehub/ui';
import { describe, expect, it } from 'vitest';
import {
  fixtureRow,
  layoutProps,
  PROPS,
  queryData,
  renderWithDatabase,
  viewData,
} from '../test-utils';
import TableLayout from './layout';

const cellOf = (rowId: string, propertyId: string): HTMLElement => {
  const cell = document.querySelector<HTMLElement>(
    `[role="row"][data-row-id="${rowId}"] [data-property-id="${propertyId}"]`,
  );
  if (!cell) throw new Error(`No cell ${propertyId} in ${rowId}`);
  return cell;
};

describe('TableLayout big pastes', () => {
  it('pastes at most 500 rows, four writes at a time, and counts the rest as skipped', async () => {
    const rows = Array.from({ length: 600 }, (_, i) =>
      fixtureRow(`row-${i}`, `Job ${i + 1}`, i + 1),
    );
    const base = layoutProps();
    const props = layoutProps({
      view: {
        ...base.view,
        properties: [
          { propertyId: PROPS.name, visible: true },
          { propertyId: PROPS.cost, visible: true },
        ],
      },
      data: viewData(queryData(rows)),
    });
    let writing = 0;
    let most = 0;
    props.actions.updateValues.mockImplementation(async (rowId) => {
      writing += 1;
      most = Math.max(most, writing);
      await new Promise((resolve) => setTimeout(resolve, 0));
      writing -= 1;
      return fixtureRow(rowId, '', 1);
    });
    renderWithDatabase(
      <ToastProvider>
        <TableLayout {...props} />
      </ToastProvider>,
    );
    const clip = rows.map((_, i) => String(i + 1)).join('\r\n');
    fireEvent.paste(cellOf('row-0', PROPS.cost), { clipboardData: { getData: () => clip } });

    await waitFor(() => expect(props.actions.updateValues).toHaveBeenCalledTimes(500), {
      timeout: 5000,
    });
    expect(props.actions.updateValues).toHaveBeenLastCalledWith('row-499', { [PROPS.cost]: '500' });
    expect(most).toBe(4);
    expect(props.actions.createRow).not.toHaveBeenCalled();
    expect(await screen.findByText("100 values didn't fit and were skipped.")).toBeInTheDocument();
  });
});
