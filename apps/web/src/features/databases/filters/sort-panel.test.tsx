import type { DatabaseMeta, Property, Sort } from '@carehub/databases';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { jobsDatabase, PROPS, testViewer } from '../fixtures';
import { mockActions } from '../test-utils';
import { SortPanel } from './sort-panel';

function renderSorts(sorts: Sort[] = [], meta: DatabaseMeta = jobsDatabase()) {
  const [first] = meta.views;
  if (!first) throw new Error('No view');
  const actions = mockActions();
  render(
    <SortPanel meta={meta} view={{ ...first, sorts }} viewer={testViewer()} actions={actions} />,
  );
  return { actions };
}

const name: Sort = { propertyId: PROPS.name, direction: 'asc' };
const due: Sort = { propertyId: PROPS.due, direction: 'asc' };
const cost: Sort = { propertyId: PROPS.cost, direction: 'desc' };
const optionTexts = (el: HTMLElement | undefined) =>
  el
    ? within(el)
        .getAllByRole('option')
        .map((o) => o.textContent)
    : [];
const handle = (property: string) =>
  screen.getByRole('button', { name: `Move the sort on ${property}` });

describe('Sort panel', () => {
  it('adds ascending sorts on the first properties not sorted yet', () => {
    const { actions } = renderSorts();
    expect(
      screen.getByText('No sorts yet. Rows keep their order in this view.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add sort' }));
    expect(actions.updateView).toHaveBeenLastCalledWith({ sorts: [name] });
    fireEvent.click(screen.getByRole('button', { name: 'Add sort' }));
    expect(actions.updateView).toHaveBeenLastCalledWith({
      sorts: [name, { propertyId: PROPS.status, direction: 'asc' }],
    });
  });

  it("changes a sort's property and direction", () => {
    const { actions } = renderSorts([due]);
    const property = screen.getByRole('combobox', { name: 'Property' });
    expect(optionTexts(property)).toEqual([
      'Name',
      'Status',
      'Priority',
      'Due date',
      'Technician',
      'Cost',
      'Paid',
      'Notes',
    ]);
    fireEvent.change(property, { target: { value: PROPS.cost } });
    expect(actions.updateView).toHaveBeenLastCalledWith({
      sorts: [{ propertyId: PROPS.cost, direction: 'asc' }],
    });
    const direction = screen.getByRole('combobox', { name: 'Direction' });
    expect(optionTexts(direction)).toEqual(['Ascending', 'Descending']);
    fireEvent.change(direction, { target: { value: 'desc' } });
    expect(actions.updateView).toHaveBeenLastCalledWith({
      sorts: [{ propertyId: PROPS.cost, direction: 'desc' }],
    });
  });

  it('offers each property to one sort only', () => {
    renderSorts([due, cost]);
    const [first, second] = screen.getAllByRole('combobox', { name: 'Property' });
    expect(optionTexts(first)).not.toContain('Cost');
    expect(optionTexts(second)).not.toContain('Due date');
  });

  it('removes one sort, or all of them', () => {
    const { actions } = renderSorts([due, cost]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove the sort on Due date' }));
    expect(actions.updateView).toHaveBeenLastCalledWith({ sorts: [cost] });
    fireEvent.click(screen.getByRole('button', { name: 'Delete sort' }));
    expect(actions.updateView).toHaveBeenLastCalledWith({ sorts: [] });
  });

  it('moves a sort with the arrow keys and says where it went', () => {
    const { actions } = renderSorts([due, cost]);
    handle('Cost').focus();
    fireEvent.keyDown(handle('Cost'), { key: 'ArrowUp' });
    expect(actions.updateView).toHaveBeenLastCalledWith({ sorts: [cost, due] });
    expect(screen.getByText('Moved the sort on Cost to 1 of 2.')).toBeInTheDocument();
    expect(handle('Cost')).toHaveFocus();
    fireEvent.keyDown(handle('Cost'), { key: 'ArrowUp' });
    expect(actions.updateView).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(handle('Cost'), { key: 'ArrowDown' });
    expect(actions.updateView).toHaveBeenLastCalledWith({ sorts: [due, cost] });
  });

  it('drags a sort by its handle to where the pointer lets go', () => {
    const { actions } = renderSorts([name, due, cost]);
    screen.getAllByRole('listitem').forEach((row, i) => {
      row.getBoundingClientRect = () =>
        ({
          top: i * 40,
          bottom: i * 40 + 40,
          height: 40,
          left: 0,
          right: 200,
          width: 200,
        }) as DOMRect;
    });
    fireEvent(
      handle('Name'),
      new MouseEvent('pointerdown', { bubbles: true, clientY: 20, button: 0 }),
    );
    fireEvent(window, new MouseEvent('pointermove', { clientY: 110 }));
    fireEvent(window, new MouseEvent('pointerup', { clientY: 110 }));
    expect(actions.updateView).toHaveBeenLastCalledWith({ sorts: [due, cost, name] });
    expect(screen.getByText('Moved the sort on Name to 3 of 3.')).toBeInTheDocument();
  });

  it('leaves the order alone when a drag ends where it started', () => {
    const { actions } = renderSorts([name, due]);
    fireEvent(
      handle('Name'),
      new MouseEvent('pointerdown', { bubbles: true, clientY: 0, button: 0 }),
    );
    fireEvent(window, new MouseEvent('pointerup', { clientY: 0 }));
    expect(actions.updateView).not.toHaveBeenCalled();
  });

  it('stops at 10 sorts', () => {
    const fields = Array.from({ length: 12 }, (_, i): Property => ({
      id: `prop-field-${i}`,
      name: `Field ${i}`,
      description: '',
      rowPage: 'always',
      config: { type: 'text' },
    }));
    const sorts = fields.slice(0, 10).map((p): Sort => ({ propertyId: p.id, direction: 'asc' }));
    renderSorts(sorts, jobsDatabase({ properties: fields }));
    expect(screen.getByText('Up to 10 sorts.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add sort' })).toBeDisabled();
  });
});
